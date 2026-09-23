import { ORDER_CONFIG } from "../core/config";
import { BURGER_RECIPE, MENU_ITEMS } from "../core/data/menu";
import type { IMenuItem } from "../core/types/menu_item";
import type { IOrder } from "../core/types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../core/types/order";
import type { ITraySnapshot } from "../core/types/tray";

function menuItem(id: string): IMenuItem {
	const item = MENU_ITEMS.find((entry) => entry.id === id);
	if (!item) throw new Error(`Unknown menu item: ${id}`);
	return item;
}

export const burger = menuItem("burger");
export const cola = menuItem("cola");
export const BURGER_IDS = BURGER_RECIPE.ingredients.map(
	(ingredient) => ingredient.id,
);

export interface MakeOrderOptions {
	id?: string;
	items?: readonly IMenuItem[];
	strictness?: number;
	timeLimit?: number;
	createdAt?: Date;
}

export function makeOrder(options: MakeOrderOptions = {}): IOrder {
	const {
		id = "test-order",
		items = [burger],
		strictness = 0.5,
		timeLimit = ORDER_CONFIG.ORDER_TIME_LIMIT_MS,
		createdAt = new Date(0),
	} = options;

	return {
		id,
		items: items.map((item) => ({
			item,
			state: ORDER_ITEM_STATE.PENDING,
		})),
		customer: { id: "normal", name: "Обычный", strictness },
		timeLimit,
		createdAt,
		status: ORDER_STATUS.PENDING,
	};
}

export function makeTraySnapshot(
	layers: readonly string[],
	username = "viewer",
	frozenAt = 0,
): ITraySnapshot {
	return { username, layers: [...layers], frozenAt };
}
