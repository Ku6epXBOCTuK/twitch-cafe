import type { IOrder } from "../types/order";
import { ORDER_STATUS } from "../types/order";
import { CUSTOMER_PRESETS } from "../data/customers";
import { MENU_ITEMS } from "../data/menu";
import { ORDER_CONFIG } from "../config";

export class OrderFactory {
	static generateOrder(rng: () => number = Math.random): IOrder {
		const item = MENU_ITEMS[Math.floor(rng() * MENU_ITEMS.length)];
		const customer =
			CUSTOMER_PRESETS[Math.floor(rng() * CUSTOMER_PRESETS.length)];
		return {
			id: `order-${Date.now()}-${Math.floor(rng() * 0xffffff)}`,
			items: [item],
			customer,
			timeLimit: ORDER_CONFIG.ORDER_TIME_LIMIT_MS,
			createdAt: new Date(),
			status: ORDER_STATUS.PENDING,
		};
	}
}
