import type { IMenuItem } from "../types/menu_item";
import { MENU_ITEM_VARIANT } from "../types/menu_item";
import type { IOrder } from "../types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../types/order";
import { CUSTOMER_PRESETS } from "../data/customers";
import { MENU_ITEMS } from "../data/menu";
import { ORDER_CONFIG } from "../config";

const PERSON_COUNT = {
	ONE: 1,
	TWO: 2,
	THREE: 3,
	FOUR: 4,
} as const;
type PersonCount = (typeof PERSON_COUNT)[keyof typeof PERSON_COUNT];

const PERSON_COUNT_DISTRIBUTION = [
	{ count: PERSON_COUNT.ONE, weight: 30 },
	{ count: PERSON_COUNT.TWO, weight: 30 },
	{ count: PERSON_COUNT.THREE, weight: 25 },
	{ count: PERSON_COUNT.FOUR, weight: 15 },
] as const satisfies readonly { count: PersonCount; weight: number }[];
const PERSON_COUNT_TOTAL_WEIGHT = PERSON_COUNT_DISTRIBUTION.reduce(
	(total, entry) => total + entry.weight,
	0,
);

const MAIN_ITEMS = MENU_ITEMS.filter(
	(item) => item.variant === MENU_ITEM_VARIANT.COMPOSITE,
);
const EXTRA_ITEMS = MENU_ITEMS.filter(
	(item) => item.variant === MENU_ITEM_VARIANT.SIMPLE,
);

function randomIndex(length: number, rng: () => number): number {
	return Math.max(0, Math.min(length - 1, Math.floor(rng() * length)));
}

function pickPersonCount(rng: () => number): PersonCount {
	const roll = Math.max(
		0,
		Math.min(PERSON_COUNT_TOTAL_WEIGHT - 1, rng() * PERSON_COUNT_TOTAL_WEIGHT),
	);
	let cumulativeWeight = 0;
	for (const entry of PERSON_COUNT_DISTRIBUTION) {
		cumulativeWeight += entry.weight;
		if (roll < cumulativeWeight) return entry.count;
	}
	return PERSON_COUNT.FOUR;
}

function pickItem(items: readonly IMenuItem[], rng: () => number): IMenuItem {
	if (items.length === 1) return items[0];
	const item = items[randomIndex(items.length, rng)];
	if (!item) throw new Error("Order menu has no selectable item");
	return item;
}

function calculateTimeLimit(
	personCount: PersonCount,
	portionCount: number,
): number {
	const extraPortions = Math.max(0, portionCount - personCount);
	return (
		ORDER_CONFIG.ORDER_TIME_LIMIT_MS +
		(personCount - 1) * ORDER_CONFIG.ORDER_PERSON_TIME_MS +
		extraPortions * ORDER_CONFIG.ORDER_EXTRA_PORTION_TIME_MS
	);
}

export class OrderFactory {
	static generateOrder(rng: () => number = Math.random): IOrder {
		const personCount = pickPersonCount(rng);
		const items = Array.from({ length: personCount }, () => ({
			item: pickItem(MAIN_ITEMS, rng),
			state: ORDER_ITEM_STATE.PENDING,
		}));

		const extraCount = randomIndex(personCount + 2, rng);
		for (let i = 0; i < extraCount; i++) {
			items.push({
				item: pickItem(EXTRA_ITEMS, rng),
				state: ORDER_ITEM_STATE.PENDING,
			});
		}

		const customer =
			CUSTOMER_PRESETS[randomIndex(CUSTOMER_PRESETS.length, rng)];
		const spawnedAt = new Date();
		return {
			id: `order-${spawnedAt.getTime()}-${Math.floor(rng() * 0xffffff)}`,
			items,
			customer,
			timeLimit: calculateTimeLimit(personCount, items.length),
			createdAt: spawnedAt,
			spawnedAt,
			takenAt: null,
			deadline: spawnedAt.getTime() + ORDER_CONFIG.SLOT_LIFETIME_MS,
			status: ORDER_STATUS.PENDING,
		};
	}
}
