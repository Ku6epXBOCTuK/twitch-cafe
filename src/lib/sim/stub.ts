import { Effect, Queue } from "effect";
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
	type CancelReason,
	type SimOutEvent,
	type SimSnapshot,
	type TaskIntent,
} from "../core/game/sim-dto";

interface StubPlayer {
	username: string;
	orderId: string;
	layers: string[];
	startedAt: number;
}

export interface StubSimOptions {
	allowedIngredientIds: ReadonlySet<string>;
}

export class StubSim implements ISimPort {
	private readonly players = new Map<string, StubPlayer>();
	private sequence = 0;

	constructor(
		readonly eventQueue: SimEventQueue,
		private readonly options: StubSimOptions,
	) {}

	startEffect(): Effect.Effect<void> {
		return Effect.void;
	}

	stopEffect(): Effect.Effect<void> {
		return Effect.void;
	}

	tick(_deltaMs: number): Effect.Effect<void> {
		return Effect.void;
	}

	startOrder(username: string, order: IOrder): void {
		this.players.set(username, {
			username,
			orderId: order.id,
			layers: [],
			startedAt: Date.now(),
		});
	}

	enqueueTask(
		username: string,
		intent: TaskIntent,
	): Effect.Effect<void, SimTaskRefusedError | SimQueueClosedError> {
		return Effect.gen(
			function* (this: StubSim) {
				const player = this.players.get(username);
				if (!player) {
					return yield* new SimTaskRefusedError({
						username,
						reason: TASK_REFUSAL.NO_CHARACTER,
					});
				}

				const now = Date.now();
				const base = {
					type: SIM_EVENT_TYPE.ACTION_COMPLETED,
					username,
					orderId: player.orderId,
					finishedAt: now,
					action: {
						kind: intent.kind,
						targetId: 0,
						startedAt: player.startedAt,
					},
				};

				if (intent.kind === ACTION_KIND.PUT) {
					if (!this.options.allowedIngredientIds.has(intent.ingredientId)) {
						return yield* new SimTaskRefusedError({
							username,
							reason: TASK_REFUSAL.UNKNOWN_INGREDIENT,
						});
					}
					player.layers.push(intent.ingredientId);
					return yield* this.offer(
						{
							...base,
							sequence: ++this.sequence,
							action: { ...base.action, ingredientId: intent.ingredientId },
						},
						username,
					);
				}

				if (intent.kind === ACTION_KIND.BIN) {
					player.layers.length = 0;
					return yield* this.offer(
						{ ...base, sequence: ++this.sequence },
						username,
					);
				}

				if (player.layers.length === 0) {
					return yield* new SimTaskRefusedError({
						username,
						reason: TASK_REFUSAL.TRAY_EMPTY,
					});
				}
				return yield* this.offer(
					{
						...base,
						sequence: ++this.sequence,
						tray: { username, layers: [...player.layers], frozenAt: now },
					},
					username,
				);
			}.bind(this),
		);
	}

	cancelOrder(username: string, _reason: CancelReason): void {
		const player = this.players.get(username);
		if (player) player.layers.length = 0;
	}

	clearTray(username: string): void {
		const player = this.players.get(username);
		if (player) player.layers.length = 0;
	}

	despawn(username: string): Effect.Effect<void, SimQueueClosedError> {
		return Effect.gen(
			function* (this: StubSim) {
				if (!this.players.delete(username)) return;
				return yield* this.offer(
					{ type: SIM_EVENT_TYPE.CHARACTER_REMOVED, username },
					username,
				);
			}.bind(this),
		);
	}

	getTraySnapshot(username: string): ITraySnapshot | undefined {
		const player = this.players.get(username);
		if (!player) return undefined;
		return { username, layers: [...player.layers], frozenAt: Date.now() };
	}

	getSnapshot(): SimSnapshot {
		return {
			simTime: Date.now(),
			characters: [...this.players.values()].map((player) => ({
				username: player.username,
				x: 0,
				y: 0,
				tray: [...player.layers],
			})),
		};
	}

	private offer(
		event: SimOutEvent,
		username: string,
	): Effect.Effect<void, SimQueueClosedError> {
		return Queue.offer(this.eventQueue, event).pipe(
			Effect.flatMap((offered) =>
				offered
					? Effect.void
					: Effect.fail(new SimQueueClosedError({ username })),
			),
		);
	}
}
