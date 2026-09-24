import type { AssessmentResult } from "../services/order-validator";
import type { IMenuItem } from "../types/menu_item";
import type { IOrder } from "../types/order";
import { OPERATION } from "./sim-dto";

export const GAME_EVENT_TYPE = {
	NOT_IN_GAME: "not_in_game",
	NO_ACTIVE_ORDER: "no_active_order",
	BUSY: "busy",
	UNKNOWN_INGREDIENT: "unknown_ingredient",
	INGREDIENT_ADDED: "ingredient_added",
	TRAY_EMPTY: "tray_empty",
	ORDER_TAKEN: "order_taken",
	EMPTY_SLOT: "empty_slot",
	SLOT_REQUIRED: "slot_required",
	MENU_STATE: "menu_state",
	DISH_SEALED: "dish_sealed",
	LAST_ITEM: "last_item",
	ORDER_SERVED: "order_served",
	TRAY_CLEARED: "tray_cleared",
	RECIPE_ARG_REQUIRED: "recipe_arg_required",
	RECIPE_SHOWN: "recipe_shown",
	RECIPE_UNKNOWN: "recipe_unknown",
	ORDER_EXPIRED: "order_expired",
} as const;

export type GameEventType =
	(typeof GAME_EVENT_TYPE)[keyof typeof GAME_EVENT_TYPE];

export const BUSY_OPERATION = {
	PUT: OPERATION.PUT,
	SERVE: OPERATION.SERVE,
	BIN: OPERATION.BIN,
	TAKE: OPERATION.TAKE,
} as const;

export type BusyOperation =
	(typeof BUSY_OPERATION)[keyof typeof BUSY_OPERATION];

export const TRAY_EMPTY_OPERATION = {
	PUT: OPERATION.PUT,
	SERVE: OPERATION.SERVE,
	BIN: OPERATION.BIN,
	NEXT: OPERATION.NEXT,
} as const;

export type TrayEmptyOperation =
	(typeof TRAY_EMPTY_OPERATION)[keyof typeof TRAY_EMPTY_OPERATION];

export type GameEventPayload =
	| { type: typeof GAME_EVENT_TYPE.NOT_IN_GAME; username: string }
	| { type: typeof GAME_EVENT_TYPE.NO_ACTIVE_ORDER; username: string }
	| {
			type: typeof GAME_EVENT_TYPE.BUSY;
			username: string;
			operation: BusyOperation;
	  }
	| {
			type: typeof GAME_EVENT_TYPE.UNKNOWN_INGREDIENT;
			username: string;
			token: string;
	  }
	| {
			type: typeof GAME_EVENT_TYPE.INGREDIENT_ADDED;
			username: string;
			ingredientId: string;
	  }
	| {
			type: typeof GAME_EVENT_TYPE.TRAY_EMPTY;
			username: string;
			operation: TrayEmptyOperation;
	  }
	| {
			type: typeof GAME_EVENT_TYPE.ORDER_TAKEN;
			username: string;
			order: IOrder;
			slot: number;
	  }
	| {
			type: typeof GAME_EVENT_TYPE.EMPTY_SLOT;
			username: string;
			slot: number;
	  }
	| { type: typeof GAME_EVENT_TYPE.SLOT_REQUIRED; username: string }
	| {
			type: typeof GAME_EVENT_TYPE.MENU_STATE;
			username: string;
			order: IOrder;
			trayLayers: readonly string[];
	  }
	| {
			type: typeof GAME_EVENT_TYPE.DISH_SEALED;
			username: string;
			order: IOrder;
			sealedLayers: readonly string[];
			nextItemIndex: number;
	  }
	| { type: typeof GAME_EVENT_TYPE.LAST_ITEM; username: string }
	| {
			type: typeof GAME_EVENT_TYPE.ORDER_SERVED;
			username: string;
			order: IOrder;
			assessment: AssessmentResult;
	  }
	| { type: typeof GAME_EVENT_TYPE.TRAY_CLEARED; username: string }
	| { type: typeof GAME_EVENT_TYPE.RECIPE_ARG_REQUIRED; username: string }
	| {
			type: typeof GAME_EVENT_TYPE.RECIPE_SHOWN;
			username: string;
			item: IMenuItem;
	  }
	| {
			type: typeof GAME_EVENT_TYPE.RECIPE_UNKNOWN;
			username: string;
			token: string;
	  }
	| {
			type: typeof GAME_EVENT_TYPE.ORDER_EXPIRED;
			username: string;
			order: IOrder;
			xpDelta: number;
	  };

export interface GameEventMetadata {
	readonly correlationId: string;
}

export type GameEvent = GameEventPayload & GameEventMetadata;
