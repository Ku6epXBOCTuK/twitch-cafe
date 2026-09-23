import type { AssessmentResult } from "../services/order-validator";
import type { IMenuItem } from "../types/menu_item";
import type { IOrder } from "../types/order";

export type GameEvent =
	| { type: "not_in_game"; username: string }
	| { type: "no_active_order"; username: string }
	| {
			type: "busy";
			username: string;
			operation: "take" | "put" | "serve" | "bin";
	  }
	| { type: "unknown_ingredient"; username: string; token: string }
	| { type: "ingredient_added"; username: string; ingredientId: string }
	| {
			type: "tray_empty";
			username: string;
			operation: "put" | "serve" | "bin" | "next";
	  }
	| {
			type: "order_taken";
			username: string;
			order: IOrder;
			slot: number;
	  }
	| { type: "empty_slot"; username: string; slot: number }
	| { type: "slot_required"; username: string }
	| {
			type: "menu_state";
			username: string;
			order: IOrder;
			trayLayers: readonly string[];
	  }
	| {
			type: "dish_sealed";
			username: string;
			order: IOrder;
			sealedLayers: readonly string[];
			nextItemIndex: number;
	  }
	| { type: "last_item"; username: string }
	| {
			type: "order_served";
			username: string;
			order: IOrder;
			assessment: AssessmentResult;
	  }
	| { type: "tray_cleared"; username: string }
	| { type: "recipe_arg_required"; username: string }
	| { type: "recipe_shown"; username: string; item: IMenuItem }
	| { type: "recipe_unknown"; username: string; token: string }
	| {
			type: "order_expired";
			username: string;
			order: IOrder;
			xpDelta: number;
	  };
