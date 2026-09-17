import { describe, expect, it } from "vitest";
import { CUSTOMER_PRESETS } from "../data/customers";
import { INGREDIENTS, MENU_ITEMS } from "../data/menu";
import type { IIngredient } from "../types/ingredient";
import type { IMenuItem } from "../types/menu_item";
import type { IOrder } from "../types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../types/order";
import { FILLING_ORDER } from "../types/recipe";
import type { ITraySnapshot } from "../types/tray";
import { OrderValidator } from "./order-validator";
import { verdictFor, xpForRating } from "./scoring";

const burger = MENU_ITEMS.find((m) => m.id === "burger")!;
const cola = MENU_ITEMS.find((m) => m.id === "cola")!;

function makeOrder(items: IMenuItem[], strictness = 0.5): IOrder {
	return {
		id: "test-order",
		items: items.map((item) => ({
			item,
			state: ORDER_ITEM_STATE.PENDING,
		})),
		customer: { id: "c1", name: "Тест", strictness },
		timeLimit: 90_000,
		createdAt: new Date(0),
		status: ORDER_STATUS.PENDING,
	};
}

function makeSnapshot(layers: string[]): ITraySnapshot {
	return { username: "viewer", layers, frozenAt: 0 };
}

describe("OrderValidator: бургер", () => {
	it("идеальная сборка — rating 1, perfect, без замечаний", () => {
		const result = OrderValidator.assessOrder(
			makeSnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder([burger]),
		);
		expect(result.rating).toBe(1);
		expect(result.verdict).toBe("perfect");
		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual([]);
		expect(result.orderIssues).toEqual([]);
	});

	it("недостача — штраф и список missing", () => {
		const result = OrderValidator.assessOrder(
			makeSnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder([burger]),
		);
		expect(result.missing).toContain(INGREDIENTS.cheese.id);
		expect(result.rating).toBeCloseTo(0.8125, 4);
	});

	it("лишний ингредиент — штраф за extra", () => {
		const result = OrderValidator.assessOrder(
			makeSnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.bunTop.id,
				"onion",
			]),
			makeOrder([burger]),
		);
		expect(result.extra).toContain("onion");
		expect(result.orderIssues).toEqual([]);
		expect(result.rating).toBeCloseTo(0.9375, 4);
	});

	it("перепутаны слои начинки — штраф за порядок", () => {
		const result = OrderValidator.assessOrder(
			makeSnapshot([
				INGREDIENTS.bunBottom.id,
				INGREDIENTS.cheese.id,
				INGREDIENTS.patty.id,
				INGREDIENTS.bunTop.id,
			]),
			makeOrder([burger]),
		);
		expect(result.orderIssues).toContain("порядок начинки нарушен");
		expect(result.rating).toBeCloseTo(0.8, 4);
	});
});

describe("OrderValidator: напиток", () => {
	it("пустой поднос — rating 0, awful, −XP", () => {
		const result = OrderValidator.assessOrder(
			makeSnapshot([]),
			makeOrder([cola]),
		);
		expect(result.rating).toBe(0);
		expect(result.verdict).toBe("awful");
		expect(result.missing).toContain("cola");
		expect(result.xpDelta).toBe(-50);
	});

	it("нужная кола на подносе — идеал", () => {
		const result = OrderValidator.assessOrder(
			makeSnapshot(["cola"]),
			makeOrder([cola]),
		);
		expect(result.rating).toBe(1);
		expect(result.extra).toEqual([]);
	});
});

describe("OrderValidator: строгость клиента", () => {
	it("гурман теряет больше за недостачу, чем добряк", () => {
		const layers = [
			INGREDIENTS.bunBottom.id,
			INGREDIENTS.patty.id,
			INGREDIENTS.bunTop.id,
		];
		const picky = OrderValidator.assessOrder(
			makeSnapshot(layers),
			makeOrder([burger], CUSTOMER_PRESETS[2].strictness),
		);
		const easy = OrderValidator.assessOrder(
			makeSnapshot(layers),
			makeOrder([burger], CUSTOMER_PRESETS[0].strictness),
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
			variant: "composite" as const,
			recipe: {
				id: "pizza",
				name: "Пицца",
				ingredients: [dough, mushroom] as IIngredient[],
				fillingOrder: FILLING_ORDER.UNORDERED,
			},
		};
		const strict = OrderValidator.assessOrder(
			makeSnapshot(["mushroom", "dough"]),
			makeOrder([pizza], 0.9),
		);
		expect(strict.orderIssues).toContain("база не на своём месте");
		expect(strict.rating).toBe(0);
	});
});

describe("scoring", () => {
	it("verdict по порогам", () => {
		expect(verdictFor(0.95)).toBe("perfect");
		expect(verdictFor(0.89)).toBe("good");
		expect(verdictFor(0.5)).toBe("ok");
		expect(verdictFor(0.1)).toBe("bad");
		expect(verdictFor(0)).toBe("awful");
	});

	it("xp симметрично вокруг 0.5", () => {
		expect(xpForRating(1)).toBe(50);
		expect(xpForRating(0.5)).toBe(0);
		expect(xpForRating(0)).toBe(-50);
	});
});
