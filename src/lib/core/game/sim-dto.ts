import type { ITraySnapshot } from "../types/tray";

export type EntityId = number;
export type IngredientId = string;

export const ACTION_KIND = {
	PUT: "put",
	SERVE: "serve",
	BIN: "bin",
} as const;

export type ActionKind = (typeof ACTION_KIND)[keyof typeof ACTION_KIND];

export const OPERATION = {
	PUT: ACTION_KIND.PUT,
	SERVE: ACTION_KIND.SERVE,
	BIN: ACTION_KIND.BIN,
	TAKE: "take",
	NEXT: "next",
} as const;

export type Operation = (typeof OPERATION)[keyof typeof OPERATION];

export type TaskIntent =
	| { kind: typeof ACTION_KIND.PUT; ingredientId: IngredientId }
	| { kind: typeof ACTION_KIND.SERVE }
	| { kind: typeof ACTION_KIND.BIN };

export const TASK_REFUSAL = {
	NO_CHARACTER: "no_character",
	BUSY: "busy",
	UNKNOWN_INGREDIENT: "unknown_ingredient",
	TRAY_EMPTY: "tray_empty",
} as const;

export type TaskRefusal = (typeof TASK_REFUSAL)[keyof typeof TASK_REFUSAL];

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
export type CharacterRemovedEvent = Extract<
	SimOutEvent,
	{ type: "CHARACTER_REMOVED" }
>;
