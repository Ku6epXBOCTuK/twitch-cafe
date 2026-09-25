import { describe, expect, it } from "vitest";
import { ORDER_CONFIG } from "../config";
import { burger, cola } from "#lib/test-support";
import { OrderFactory } from "./order-factory";

function sequence(values: readonly number[]): () => number {
	let index = 0;
	return () => values[index++] ?? 0;
}

describe("OrderFactory", () => {
	it.each([
		{ value: 0, personCount: 1 },
		{ value: 0.299, personCount: 1 },
		{ value: 0.3, personCount: 2 },
		{ value: 0.599, personCount: 2 },
		{ value: 0.6, personCount: 3 },
		{ value: 0.849, personCount: 3 },
		{ value: 0.85, personCount: 4 },
		{ value: 0.999, personCount: 4 },
	])(
		"выбирает размер группы $personCount по границам весов",
		({ value, personCount }) => {
			const order = OrderFactory.generateOrder(sequence([value, 0, 0, 0]));

			expect(order.items).toHaveLength(personCount);
			expect(order.items.every((entry) => entry.item.id === burger.id)).toBe(
				true,
			);
			expect(order.timeLimit).toBe(
				ORDER_CONFIG.ORDER_TIME_LIMIT_MS +
					(personCount - 1) * ORDER_CONFIG.ORDER_PERSON_TIME_MS,
			);
			expect(order).not.toHaveProperty("personCount");
		},
	);

	it("добавляет неравномерные повторяющиеся дополнительные порции", () => {
		const order = OrderFactory.generateOrder(sequence([0.4, 0.9, 0, 0]));

		expect(order.items.map((entry) => entry.item.id)).toEqual([
			burger.id,
			burger.id,
			cola.id,
			cola.id,
			cola.id,
		]);
		expect(order.timeLimit).toBe(
			ORDER_CONFIG.ORDER_TIME_LIMIT_MS +
				ORDER_CONFIG.ORDER_PERSON_TIME_MS +
				3 * ORDER_CONFIG.ORDER_EXTRA_PORTION_TIME_MS,
		);
	});

	it("учитывает дополнительные порции в времени", () => {
		const order = OrderFactory.generateOrder(sequence([0.9, 0.99, 0, 0]));

		expect(order.items.map((entry) => entry.item.id)).toEqual([
			burger.id,
			burger.id,
			burger.id,
			burger.id,
			cola.id,
			cola.id,
			cola.id,
			cola.id,
			cola.id,
		]);
		expect(order.timeLimit).toBe(
			ORDER_CONFIG.ORDER_TIME_LIMIT_MS +
				3 * ORDER_CONFIG.ORDER_PERSON_TIME_MS +
				5 * ORDER_CONFIG.ORDER_EXTRA_PORTION_TIME_MS,
		);
	});
});
