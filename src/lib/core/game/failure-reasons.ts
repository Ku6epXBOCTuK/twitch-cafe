import { TASK_REFUSAL } from "./sim-dto";

export const TAKE_ORDER_REASON = {
	BUSY: TASK_REFUSAL.BUSY,
	EMPTY_SLOT: "empty_slot",
} as const;

export type TakeOrderReason =
	(typeof TAKE_ORDER_REASON)[keyof typeof TAKE_ORDER_REASON];

export const NEXT_DISH_REASON = {
	NO_ORDER: "no_order",
	LAST_ITEM: "last_item",
	TRAY_EMPTY: TASK_REFUSAL.TRAY_EMPTY,
} as const;

export type NextDishReason =
	(typeof NEXT_DISH_REASON)[keyof typeof NEXT_DISH_REASON];
