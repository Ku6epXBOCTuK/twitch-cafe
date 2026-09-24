import type { IOrder } from "../types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../types/order";
import { CUSTOMER_PRESETS } from "../data/customers";
import { MENU_ITEMS } from "../data/menu";
import { ORDER_CONFIG } from "../config";

export class OrderFactory {
	static generateOrder(rng: () => number = Math.random): IOrder {
		const item = MENU_ITEMS[Math.floor(rng() * MENU_ITEMS.length)];
		const customer =
			CUSTOMER_PRESETS[Math.floor(rng() * CUSTOMER_PRESETS.length)];
		const spawnedAt = new Date();
		return {
			id: `order-${spawnedAt.getTime()}-${Math.floor(rng() * 0xffffff)}`,
			items: [{ item, state: ORDER_ITEM_STATE.PENDING }],
			customer,
			timeLimit: ORDER_CONFIG.ORDER_TIME_LIMIT_MS,
			createdAt: spawnedAt,
			spawnedAt,
			takenAt: null,
			deadline: spawnedAt.getTime() + ORDER_CONFIG.SLOT_LIFETIME_MS,
			status: ORDER_STATUS.PENDING,
		};
	}
}
