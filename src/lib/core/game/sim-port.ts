import { Data, Effect, Queue, Scope } from "effect";
import type { IOrder } from "../types/order";
import type { ITraySnapshot } from "../types/tray";
import type {
	CancelReason,
	SimOutEvent,
	SimSnapshot,
	TaskIntent,
	TaskRefusal,
} from "./sim-dto";

export const SIM_EVENT_QUEUE_CAPACITY = 64;

export type SimEventQueue = Queue.Queue<SimOutEvent>;

export class SimTaskRefusedError extends Data.TaggedError("SimTaskRefused")<{
	readonly username: string;
	readonly reason: TaskRefusal;
}> {}

export class SimQueueClosedError extends Data.TaggedError("SimQueueClosed")<{
	readonly username: string;
}> {}

export function makeSimEventQueue(
	capacity: number = SIM_EVENT_QUEUE_CAPACITY,
): SimEventQueue {
	return Effect.runSync(Queue.bounded<SimOutEvent>(capacity));
}

export interface ISimPort {
	readonly eventQueue: SimEventQueue;
	startEffect(): Effect.Effect<void, never, Scope.Scope>;
	stopEffect(): Effect.Effect<void>;
	tick(deltaMs: number): Effect.Effect<void, SimQueueClosedError>;
	startOrder(username: string, order: IOrder): void;
	enqueueTask(
		username: string,
		intent: TaskIntent,
	): Effect.Effect<void, SimTaskRefusedError | SimQueueClosedError>;
	cancelOrder(username: string, reason: CancelReason): void;
	clearTray(username: string): void;
	despawn(username: string): Effect.Effect<void, SimQueueClosedError>;
	getTraySnapshot(username: string): ITraySnapshot | undefined;
	getSnapshot(): SimSnapshot;
}
