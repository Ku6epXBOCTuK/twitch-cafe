import type { IOrder } from "../types/order";
import type { ITraySnapshot } from "../types/tray";
import type {
	ActionCompletedEvent,
	ActionStartedEvent,
	SimSnapshot,
	TaskAck,
	TaskIntent,
} from "./sim-dto";

export interface ISimPort {
	/** `!join`: поднять персонажа, поднос и срез заказа. */
	startOrder(username: string, order: IOrder): void;
	/** `!put` / `!bin` / `!serve`: принять или отказать. */
	enqueueTask(username: string, intent: TaskIntent): TaskAck;
	/** Таймаут/выход: оборвать действие и очистить поднос. */
	cancelOrder(username: string, reason: "timeout" | "leave"): void;
	/** Забрать персонажа (дисконнект). */
	despawn(username: string): void;
	/** Чтение: `!menu`, снапшот оверлея. */
	getTraySnapshot(username: string): ITraySnapshot | undefined;
	getSnapshot(): SimSnapshot;
}

export interface ISimEvents {
	onActionStarted(e: ActionStartedEvent): void;
	onActionCompleted(e: ActionCompletedEvent): void;
	onCharacterRemoved(e: { username: string }): void;
}
