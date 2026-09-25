import { Duration, Effect, Match, Queue, Scope } from "effect";
import type { IOrder } from "../core/types/order";
import type { ITraySnapshot } from "../core/types/tray";
import {
	SimQueueClosedError,
	SimTaskRefusedError,
	type ISimPort,
	type SimEventQueue,
} from "../core/game/sim-port";
import {
	ACTION_KIND,
	SIM_EVENT_TYPE,
	TASK_REFUSAL,
	type ActionKind,
	type CancelReason,
	type SimOutEvent,
	type SimSnapshot,
	type TaskIntent,
} from "../core/game/sim-dto";
import { SIM_CONFIG } from "./config";
import {
	createWorld,
	findStation,
	removePlayer,
	spawnPlayer,
	type PlayerEntities,
	type SimWorld,
} from "./world";
import { STATION_KIND, type ActionComponent, type SimEntity } from "./types";

export interface MiniplexSimOptions {
	readonly allowedIngredientIds: ReadonlySet<string>;
	readonly speed?: number;
}

function copyAction(action: ActionComponent): ActionComponent {
	return { ...action };
}

function createAction(
	intent: TaskIntent,
	targetId: number,
	startedAt: number,
): ActionComponent {
	return Match.type<TaskIntent>().pipe(
		Match.when({ kind: ACTION_KIND.PUT }, (current) => ({
			kind: current.kind,
			ingredientId: current.ingredientId,
			targetId,
			startedAt,
		})),
		Match.when({ kind: ACTION_KIND.BIN }, (current) => ({
			kind: current.kind,
			targetId,
			startedAt,
		})),
		Match.when({ kind: ACTION_KIND.SERVE }, (current) => ({
			kind: current.kind,
			targetId,
			startedAt,
		})),
		Match.exhaustive,
	)(intent);
}

function distanceTo(
	from: { x: number; y: number },
	to: { x: number; y: number },
): number {
	return Math.hypot(to.x - from.x, to.y - from.y);
}

function moveToward(
	from: { x: number; y: number },
	to: { x: number; y: number },
	distance: number,
): { x: number; y: number; reached: boolean } {
	const remaining = distanceTo(from, to);
	if (remaining <= distance || remaining === 0) {
		return { x: to.x, y: to.y, reached: true };
	}
	const ratio = distance / remaining;
	return {
		x: from.x + (to.x - from.x) * ratio,
		y: from.y + (to.y - from.y) * ratio,
		reached: false,
	};
}

export class MiniplexSim implements ISimPort {
	private readonly world: SimWorld = createWorld();
	private readonly players = new Map<string, PlayerEntities>();
	private readonly speed: number;
	private simTime = 0;
	private sequence = 0;
	private outbox: SimOutEvent[] = [];

	constructor(
		readonly eventQueue: SimEventQueue,
		private readonly options: MiniplexSimOptions,
	) {
		this.speed = options.speed ?? SIM_CONFIG.SPEED;
	}

	startEffect(): Effect.Effect<void, never, Scope.Scope> {
		const deltaMs = 1000 / SIM_CONFIG.TICK_HZ;
		return Effect.forkScoped(
			Effect.forever(
				Effect.sleep(Duration.millis(deltaMs)).pipe(
					Effect.andThen(this.tick(deltaMs)),
				),
			),
		).pipe(Effect.asVoid);
	}

	stopEffect(): Effect.Effect<void> {
		return Effect.void;
	}

	startOrder(username: string, order: IOrder): void {
		const previous = this.players.get(username);
		if (previous) removePlayer(this.world, previous);
		this.players.set(username, spawnPlayer(this.world, username, order.id));
	}

	enqueueTask(
		username: string,
		intent: TaskIntent,
	): Effect.Effect<void, SimTaskRefusedError | SimQueueClosedError> {
		return Effect.gen(
			function* (this: MiniplexSim) {
				const entities = this.players.get(username);
				if (!entities) {
					return yield* new SimTaskRefusedError({
						username,
						reason: TASK_REFUSAL.NO_CHARACTER,
					});
				}
				if (entities.player.action) {
					return yield* new SimTaskRefusedError({
						username,
						reason: TASK_REFUSAL.BUSY,
					});
				}

				const targetKind = this.targetKind(intent.kind);
				const target = targetKind
					? findStation(this.world, targetKind)
					: undefined;
				if (!target) {
					return yield* new SimTaskRefusedError({
						username,
						reason: TASK_REFUSAL.UNKNOWN_INGREDIENT,
					});
				}
				if (
					intent.kind === ACTION_KIND.PUT &&
					!this.options.allowedIngredientIds.has(intent.ingredientId)
				) {
					return yield* new SimTaskRefusedError({
						username,
						reason: TASK_REFUSAL.UNKNOWN_INGREDIENT,
					});
				}
				const tray = entities.tray.tray;
				if (intent.kind === ACTION_KIND.SERVE && tray?.layers.length === 0) {
					return yield* new SimTaskRefusedError({
						username,
						reason: TASK_REFUSAL.TRAY_EMPTY,
					});
				}

				const action = createAction(
					intent,
					this.world.id(target)!,
					this.simTime,
				);
				entities.player.action = action;
				this.outbox.push({
					type: SIM_EVENT_TYPE.ACTION_STARTED,
					username,
					action: copyAction(action),
				});
				yield* this.flushOutbox();
			}.bind(this),
		);
	}

	cancelOrder(username: string, _reason: CancelReason): void {
		const entities = this.players.get(username);
		if (!entities) return;
		this.world.removeComponent(entities.player, "action");
		if (entities.tray.tray) entities.tray.tray.layers.length = 0;
	}

	clearTray(username: string): void {
		const entities = this.players.get(username);
		if (entities?.tray.tray) entities.tray.tray.layers.length = 0;
	}

	despawn(username: string): Effect.Effect<void, SimQueueClosedError> {
		return Effect.gen(
			function* (this: MiniplexSim) {
				const entities = this.players.get(username);
				if (!entities) return;
				removePlayer(this.world, entities);
				this.players.delete(username);
				this.outbox.push({
					type: SIM_EVENT_TYPE.CHARACTER_REMOVED,
					username,
				});
				yield* this.flushOutbox();
			}.bind(this),
		);
	}

	getTraySnapshot(username: string): ITraySnapshot | undefined {
		const entities = this.players.get(username);
		if (!entities?.tray.tray) return undefined;
		return {
			username,
			layers: [...entities.tray.tray.layers],
			frozenAt: this.simTime,
		};
	}

	getSnapshot(): SimSnapshot {
		return {
			simTime: this.simTime,
			characters: [...this.players.values()].map(({ player, tray }) => ({
				username: player.chef!.username,
				action: player.action ? copyAction(player.action) : undefined,
				x: player.transform?.x ?? 0,
				y: player.transform?.y ?? 0,
				tray: [...(tray.tray?.layers ?? [])],
			})),
		};
	}

	tick(deltaMs: number): Effect.Effect<void, SimQueueClosedError> {
		return Effect.gen(
			function* (this: MiniplexSim) {
				if (deltaMs <= 0) return;
				this.simTime += deltaMs;
				for (const { player } of this.players.values()) {
					const action = player.action;
					const transform = player.transform;
					if (!action || !transform) continue;
					const target = this.world.entity(action.targetId);
					const targetTransform = target?.transform;
					if (!targetTransform) {
						this.world.removeComponent(player, "action");
						continue;
					}
					const movement = moveToward(
						transform,
						targetTransform,
						this.speed * deltaMs,
					);
					transform.x = movement.x;
					transform.y = movement.y;
					transform.facing =
						Math.atan2(
							targetTransform.y - transform.y,
							targetTransform.x - transform.x,
						) || transform.facing;
					if (movement.reached) this.completeAction(player);
				}
				yield* this.flushOutbox();
			}.bind(this),
		);
	}

	private targetKind(kind: ActionKind) {
		return Match.type<ActionKind>().pipe(
			Match.when(ACTION_KIND.PUT, () => STATION_KIND.SHELF),
			Match.when(ACTION_KIND.BIN, () => STATION_KIND.BIN),
			Match.when(ACTION_KIND.SERVE, () => STATION_KIND.SERVING),
			Match.exhaustive,
		)(kind);
	}

	private completeAction(player: SimEntity): void {
		const action = player.action;
		if (!action) return;
		this.world.removeComponent(player, "action");
		const tray = player.carries
			? this.world.entity(player.carries.trayId)?.tray
			: undefined;
		const snapshot = this.applyAction(action, tray);
		const username = player.chef?.username;
		if (!username) return;
		this.outbox.push({
			type: SIM_EVENT_TYPE.ACTION_COMPLETED,
			username,
			orderId: player.order?.orderId ?? "",
			sequence: ++this.sequence,
			finishedAt: this.simTime,
			action: copyAction(action),
			...(snapshot ? { tray: snapshot } : {}),
		});
	}

	private applyAction(
		action: ActionComponent,
		tray: { username: string; layers: string[] } | undefined,
	): ITraySnapshot | undefined {
		return Match.type<ActionComponent>().pipe(
			Match.when({ kind: ACTION_KIND.PUT }, (current) => {
				if (tray && current.ingredientId)
					tray.layers.push(current.ingredientId);
				return undefined;
			}),
			Match.when({ kind: ACTION_KIND.BIN }, () => {
				if (tray) tray.layers.length = 0;
				return undefined;
			}),
			Match.when({ kind: ACTION_KIND.SERVE }, () =>
				tray
					? {
							username: tray.username,
							layers: [...tray.layers],
							frozenAt: this.simTime,
						}
					: undefined,
			),
			Match.exhaustive,
		)(action);
	}

	private flushOutbox(): Effect.Effect<void, SimQueueClosedError> {
		if (this.outbox.length === 0) return Effect.void;
		const events = this.outbox.splice(0);
		return Effect.forEach(events, (event) => this.offer(event));
	}

	private offer(event: SimOutEvent): Effect.Effect<void, SimQueueClosedError> {
		return Queue.offer(this.eventQueue, event).pipe(
			Effect.flatMap((offered) =>
				offered
					? Effect.void
					: Effect.fail(new SimQueueClosedError({ username: event.username })),
			),
		);
	}
}
