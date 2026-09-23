import { describe, expect, it } from "vitest";
import { CUSTOMER_PRESETS } from "../data/customers";
import { INGREDIENTS } from "../data/menu";
import type { IIngredient } from "../types/ingredient";
import { MENU_ITEM_KIND } from "../types/menu_item";
import { FILLING_ORDER } from "../types/recipe";
import { burger, cola, makeOrder, makeTraySnapshot } from "#lib/test-support";
import { OrderValidator } from "./order-validator";

describe("OrderValidator: бургер (единственное блюдо на current)", () => {
	it("идеальная сборка — rating 1, perfect, без замечаний", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder({ items: [burger] }),
		);
		expect(result.rating).toBe(1);
		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual([]);
		expect(result.orderIssues).toEqual([]);
	});

	it("недостача — штраф и список missing", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder({ items: [burger] }),
		);
		expect(result.missing).toContain(INGREDIENTS.cheese.id);
		expect(result.rating).toBeCloseTo(0.8125, 4);
	});

	it("лишний ингредиент — штраф за extra", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.bunTop.id,
				"onion",
			]),
			makeOrder({ items: [burger] }),
		);
		expect(result.extra).toContain("onion");
		expect(result.orderIssues).toEqual([]);
		expect(result.rating).toBeLessThan(1);
	});

	it("лишняя котлета попадает в extra", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder({ items: [burger] }),
		);
		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual([INGREDIENTS.patty.id]);
		expect(result.orderIssues).toEqual([]);
		expect(result.rating).toBeLessThan(1);
	});

	it("недостающие базы и лишняя котлета не ломают проверку порядка", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([
				INGREDIENTS.patty.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.cheese.id,
			]),
			makeOrder({ items: [burger] }),
		);
		expect(result.missing).toEqual([
			INGREDIENTS.bunBottom.id,
			INGREDIENTS.bunTop.id,
		]);
		expect(result.extra).toEqual([INGREDIENTS.patty.id]);
		expect(result.orderIssues).toEqual([]);
		expect(result.rating).toBeLessThan(1);
	});

	it("лишняя base попадает в extra", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder({ items: [burger] }),
		);
		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual([INGREDIENTS.bunBottom.id]);
		expect(result.orderIssues).toEqual([]);
		expect(result.rating).toBeLessThan(1);
	});

	it("перепутаны слои начинки — штраф за порядок", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder({ items: [burger] }),
		);
		expect(result.orderIssues).toContain("порядок начинки нарушен");
		expect(result.rating).toBeCloseTo(0.8, 4);
	});
});

describe("OrderValidator: напиток", () => {
	it("пустой current — rating 0, awful, −XP", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([]),
			makeOrder({ items: [cola] }),
		);
		expect(result.rating).toBe(0);
		expect(result.missing).toContain(cola.id);
		expect(result.xpDelta).toBeLessThan(0);
	});

	it("нужная кола на подносе — идеал", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([cola.id]),
			makeOrder({ items: [cola] }),
		);
		expect(result.rating).toBe(1);
		expect(result.extra).toEqual([]);
	});

	it("дубль Cola попадает в extra", () => {
		const result = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot([cola.id, cola.id]),
			makeOrder({ items: [cola] }),
		);
		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual([cola.id]);
		expect(result.rating).toBeLessThan(1);
	});
});

describe("OrderValidator: dishes-модель (sealed + current)", () => {
	it("бургер запечатан + кола на подносе = perfect по двум блюдам", () => {
		const sealedBurger = makeTraySnapshot([
			INGREDIENTS.bunBottom.id,
			INGREDIENTS.patty.id,
			INGREDIENTS.cheese.id,
			INGREDIENTS.bunTop.id,
		]);
		const result = OrderValidator.assessOrderDishes(
			[sealedBurger],
			makeTraySnapshot([cola.id]),
			makeOrder({ items: [burger, cola] }),
		);
		expect(result.rating).toBe(1);
	});

	it("burger запечатан плохо, кола идеальна — среднее", () => {
		const sealedBurger = makeTraySnapshot([
			INGREDIENTS.bunBottom.id,
			INGREDIENTS.patty.id,
			INGREDIENTS.bunTop.id,
		]); // нет сыра → 0.8125
		const result = OrderValidator.assessOrderDishes(
			[sealedBurger],
			makeTraySnapshot([cola.id]),
			makeOrder({ items: [burger, cola] }),
		);
		expect(result.rating).toBeCloseTo((0.8125 + 1) / 2, 4);
	});

	it("current null (serve без последнего блюда) — последнее блюдо провалено", () => {
		const sealedBurger = makeTraySnapshot([
			INGREDIENTS.bunBottom.id,
			INGREDIENTS.patty.id,
			INGREDIENTS.cheese.id,
			INGREDIENTS.bunTop.id,
		]);
		const result = OrderValidator.assessOrderDishes(
			[sealedBurger],
			null,
			makeOrder({ items: [burger, cola] }),
		);
		expect(result.rating).toBeCloseTo(0.5, 4);
		expect(result.missing).toContain(cola.id);
	});
});

describe("OrderValidator: строгость клиента", () => {
	it("гурман теряет больше за недостачу, чем добряк", () => {
		const layers = [
			INGREDIENTS.bunBottom.id,
			INGREDIENTS.patty.id,
			INGREDIENTS.bunTop.id,
		];
		const picky = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot(layers),
			makeOrder({
				items: [burger],
				strictness: CUSTOMER_PRESETS[2].strictness,
			}),
		);
		const easy = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot(layers),
			makeOrder({
				items: [burger],
				strictness: CUSTOMER_PRESETS[0].strictness,
			}),
		);
		expect(picky.rating).toBeCloseTo(0.7225, 4);
		expect(easy.rating).toBeCloseTo(0.88, 4);
		expect(picky.rating).toBeLessThan(easy.rating);
	});

	it("unordered: база не внизу штрафуется только строгостью", () => {
		const dough: IIngredient = { id: "dough", name: "Тесто", category: "base" };
		const mushroom: IIngredient = {
			id: "mushroom",
			name: "Грибы",
			category: "filling",
		};
		const pizza = {
			id: "pizza",
			name: "Пицца",
			kind: MENU_ITEM_KIND.PIZZA,
			variant: "composite" as const,
			recipe: {
				id: "pizza",
				name: "Пицца",
				ingredients: [dough, mushroom] as IIngredient[],
				fillingOrder: FILLING_ORDER.UNORDERED,
			},
		};
		const strict = OrderValidator.assessOrderDishes(
			[],
			makeTraySnapshot(["mushroom", "dough"]),
			makeOrder({ items: [pizza], strictness: 0.9 }),
		);
		expect(strict.orderIssues).toContain("база не на своём месте");
		expect(strict.rating).toBe(0);
	});
});
