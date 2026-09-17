import type { ITraySnapshot } from "../types/tray";

export type EntityId = number;
export type IngredientId = string;

export type ActionKind = "put" | "serve" | "bin";

export type TaskIntent =
	| { kind: "put"; ingredientId: IngredientId }
	| { kind: "serve" }
	| { kind: "bin" };

export type TaskRefusal =
	| "no_character" // зритель не в игре
	| "busy" // персонаж уже что-то делает — «персонаж ещё идёт»
	| "unknown_ingredient" // нет полки с таким ингредиентом
	| "tray_empty"; // !serve с пустым подносом
// busy — часть контракта асинхронной модели. Заглушка его не возвращает
// (действие мгновенно), реальная SIM вернёт, когда персонаж занят.

export type TaskAck = { ok: true } | { ok: false; reason: TaskRefusal };

export interface ActionInfo {
	kind: ActionKind;
	ingredientId?: IngredientId;
	targetId: EntityId;
	startedAt: number;
}

export interface SimCharacterSnapshot {
	username: string;
	action?: ActionInfo;
	x: number;
	y: number;
	tray: string[];
}

export interface SimSnapshot {
	simTime: number;
	characters: SimCharacterSnapshot[];
}

export type SimOutEvent =
	| { type: "ACTION_STARTED"; username: string; action: ActionInfo }
	| {
			type: "ACTION_COMPLETED";
			username: string;
			finishedAt: number;
			action: ActionInfo;
			tray?: ITraySnapshot; // только для kind === "serve"
	  }
	| { type: "CHARACTER_REMOVED"; username: string };

/** Те же типы для ISimEvents — без дублирования структур. */
export type ActionStartedEvent = Extract<
	SimOutEvent,
	{ type: "ACTION_STARTED" }
>;
export type ActionCompletedEvent = Extract<
	SimOutEvent,
	{ type: "ACTION_COMPLETED" }
>;
