import type { IOrder } from "../types/order";
import { ORDER_STATUS } from "../types/order";
import { ORDER_CONFIG } from "../config";
import { OrderFactory } from "../services/order-factory";

export type TakeOrderResult =
	{ ok: true; order: IOrder } | { ok: false; reason: "empty_slot" };

type Timer = ReturnType<typeof setTimeout>;

/** Доска входящих заказов: автоген в первый пустой слот, сгорание невзятых. */
export class IncomingOrders {
	private readonly slots: (IOrder | null)[];
	private readonly burnTimers: (Timer | null)[];
	private spawnTimer: Timer | null = null;

	constructor(
		private readonly makeOrder: () => IOrder = OrderFactory.generateOrder,
	) {
		this.slots = Array.from({ length: ORDER_CONFIG.SLOT_COUNT }, () => null);
		this.burnTimers = Array.from(
			{ length: ORDER_CONFIG.SLOT_COUNT },
			() => null,
		);
	}

	start(): void {
		if (this.spawnTimer) return;
		this.spawnTimer = setInterval(
			() => this.spawn(),
			ORDER_CONFIG.SPAWN_INTERVAL_MS,
		);
	}

	stop(): void {
		if (this.spawnTimer) {
			clearInterval(this.spawnTimer);
			this.spawnTimer = null;
		}
		for (let i = 0; i < this.burnTimers.length; i++) {
			if (this.burnTimers[i]) clearTimeout(this.burnTimers[i]!);
			this.burnTimers[i] = null;
		}
	}

	getSlots(): readonly (IOrder | null)[] {
		return [...this.slots];
	}

	takeOrder(slotIndex: number): TakeOrderResult {
		if (slotIndex < 0 || slotIndex >= this.slots.length) {
			return { ok: false, reason: "empty_slot" };
		}
		const order = this.slots[slotIndex];
		if (!order) return { ok: false, reason: "empty_slot" };

		this.slots[slotIndex] = null;
		if (this.burnTimers[slotIndex]) clearTimeout(this.burnTimers[slotIndex]!);
		this.burnTimers[slotIndex] = null;
		return { ok: true, order };
	}

	/** Один тик спавна: кладёт заказ в первый пустой слот, если он есть. */
	spawn(): void {
		const index = this.slots.findIndex((slot) => slot === null);
		if (index === -1) return;

		const order = this.makeOrder();
		this.slots[index] = order;
		this.burnTimers[index] = setTimeout(
			() => this.burn(order.id),
			ORDER_CONFIG.SLOT_LIFETIME_MS,
		);
	}

	private burn(orderId: string): void {
		const index = this.slots.findIndex((slot) => slot?.id === orderId);
		if (index === -1) return;

		this.slots[index]!.status = ORDER_STATUS.EXPIRED;
		this.slots[index] = null;
		this.burnTimers[index] = null;
	}
}
