import { Effect, Queue } from "effect";
import type { IOrder } from "../core/types/order";
import type { ITraySnapshot } from "../core/types/tray";
import {
	ACTION_KIND,
	SIM_EVENT_TYPE,
	type CancelReason,
	type SimOutEvent,
	type SimSnapshot,
	type TaskIntent,
} from "../core/game/sim-dto";
import {
	makeSimEventQueue,
	SimQueueClosedError,
	type ISimPort,
	type SimEventQueue,
} from "../core/game/sim-port";

export class RecordingPort implements ISimPort {
	private readonly orderIds = new Map<string, string>();
	private sequence = 0;
	startOrders: IOrder[] = [];
	tasks: Array<{ username: string; intent: TaskIntent }> = [];
	cancels: CancelReason[] = [];
	trayLayers: string[] = [];
	clearTrayCalls = 0;

	constructor(readonly eventQueue: SimEventQueue = makeSimEventQueue()) {}

	startOrder(username: string, order: IOrder): void {
		this.startOrders.push(order);
		this.orderIds.set(username, order.id);
	}

	enqueueTask(
		username: string,
		intent: TaskIntent,
	): Effect.Effect<void, SimQueueClosedError> {
		return Effect.gen(
			function* (this: RecordingPort) {
				this.tasks.push({ username, intent });
				if (intent.kind === ACTION_KIND.SERVE) {
					return yield* this.offer(
						{
							type: SIM_EVENT_TYPE.ACTION_COMPLETED,
							username,
							orderId: this.orderIds.get(username) ?? "",
							sequence: ++this.sequence,
							finishedAt: Date.now(),
							action: {
								kind: ACTION_KIND.SERVE,
								targetId: 0,
								startedAt: 0,
							},
							tray: {
								username,
								layers: [...this.trayLayers],
								frozenAt: Date.now(),
							},
						},
						username,
					);
				}
				if (intent.kind === ACTION_KIND.BIN) this.trayLayers = [];
				if (intent.kind === ACTION_KIND.PUT) {
					this.trayLayers.push(intent.ingredientId);
				}
			}.bind(this),
		);
	}

	cancelOrder(_username: string, reason: CancelReason): void {
		this.cancels.push(reason);
	}

	clearTray(): void {
		this.clearTrayCalls++;
		this.trayLayers = [];
	}

	despawn(username: string): Effect.Effect<void, SimQueueClosedError> {
		return this.offer(
			{ type: SIM_EVENT_TYPE.CHARACTER_REMOVED, username },
			username,
		);
	}

	getTraySnapshot(username: string): ITraySnapshot {
		return { username, layers: [...this.trayLayers], frozenAt: 0 };
	}

	getSnapshot(): SimSnapshot {
		return { simTime: 0, characters: [] };
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
