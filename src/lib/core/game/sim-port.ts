import { Data, Effect, Queue } from "effect";
import type { IOrder } from "../types/order";
import type { ITraySnapshot } from "../types/tray";
import type {
	ActionCompletedEvent,
	ActionStartedEvent,
	CancelReason,
	CharacterRemovedEvent,
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

export interface ISimEvents {
	onActionStarted(e: ActionStartedEvent): void;
	onActionCompleted(e: ActionCompletedEvent): void;
	onCharacterRemoved(e: CharacterRemovedEvent): void;
}
