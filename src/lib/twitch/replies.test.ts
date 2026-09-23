import { describe, expect, it } from "vitest";
import type { TaskAck } from "../core/game/sim-dto";
import type { AssessmentResult } from "../core/services/order-validator";
import { INGREDIENTS } from "../core/data/menu";
import { burger, cola, makeOrder } from "#lib/test-support";
import {
	itemLabel,
	orderDescription,
	replyBinAck,
	replyBusy,
	replyNextAck,
	replyNextLastItem,
	replyNextTrayEmpty,
	replyNoActiveOrder,
	replyNotInGame,
	replyPutAck,
	replyRecipeNoArg,
	replyRecipeOk,
	replyRecipeUnknown,
	replyResult,
	replyServeAck,
	replyTakeBusy,
	replyTakeEmptySlot,
	replyTakeNoSlot,
	replyTakeOk,
	replyUnknownIngredient,
} from "./replies";

const username = "alice";
const order = makeOrder({ id: "reply-order", items: [burger] });

const successAck: TaskAck = { ok: true };
const refusalAck: TaskAck = { ok: false, reason: "no_character" };

function makeAssessment(
	overrides: Partial<AssessmentResult> = {},
): AssessmentResult {
	return {
		rating: 1,
		verdict: "good",
		missing: [],
		extra: [],
		orderIssues: [],
		xpDelta: 7,
		...overrides,
	};
}

describe("reply contract", () => {
	it("formats status replies", () => {
		expect(replyNotInGame(username)).toBe("alice, ты не в игре.");
		expect(replyNoActiveOrder(username)).toBe(
			"alice, у тебя нет активного заказа.",
		);
		expect(replyBusy(username)).toBe("alice, персонаж ещё идёт — подожди.");
	});

	it("formats ingredient and task replies", () => {
		expect(replyUnknownIngredient(username, "железо")).toBe(
			"alice, нет такого ингредиента: “железо”.",
		);
		expect(replyPutAck(username, successAck, INGREDIENTS.cheese.id)).toBe(
			"alice положил: Сыр.",
		);
		expect(replyPutAck(username, refusalAck, INGREDIENTS.cheese.id)).toBe(
			replyNotInGame(username),
		);
		expect(replyServeAck(username, { ok: false, reason: "tray_empty" })).toBe(
			"alice, поднос пуст — сначала !put ингредиенты.",
		);
		expect(replyBinAck(username, successAck)).toBe(
			"alice сбросил поднос в мусорку.",
		);
	});

	it("formats assessment and diagnostic details", () => {
		expect(replyResult(username, makeAssessment())).toBe(
			"alice: Хорошо! +7 XP.",
		);
		expect(
			replyResult(
				username,
				makeAssessment({
					verdict: "bad",
					missing: [INGREDIENTS.cheese.id],
					extra: [INGREDIENTS.patty.id],
					orderIssues: ["порядок начинки нарушен"],
					xpDelta: -3,
				}),
			),
		).toBe(
			"alice: Плохо… -3 XP. (не хватает: Сыр; лишнее: Котлета; порядок начинки нарушен)",
		);
	});

	it("formats order, slot and recipe replies", () => {
		expect(itemLabel(burger)).toBe(
			"Бургер (Нижняя булочка, Котлета, Сыр, Верхняя булочка)",
		);
		expect(orderDescription(makeOrder({ items: [burger, cola] }))).toBe(
			"Бургер (Нижняя булочка, Котлета, Сыр, Верхняя булочка), Кола",
		);
		expect(replyTakeOk(username, order, 1)).toBe(
			"alice взял заказ №1: Бургер (Нижняя булочка, Котлета, Сыр, Верхняя булочка).",
		);
		expect(replyTakeNoSlot(username)).toBe(
			"alice, напиши номер слота 1–3: !взять 1.",
		);
		expect(replyTakeBusy(username)).toBe("alice, у тебя уже есть заказ.");
		expect(replyTakeEmptySlot(username)).toBe("alice, этот слот пуст.");
		expect(replyRecipeNoArg(username)).toBe(
			"alice, напиши название блюда: !рецепт бургер.",
		);
		expect(replyRecipeUnknown(username, "абракадабра")).toBe(
			"alice, нет такого блюда: “абракадабра”.",
		);
		expect(replyRecipeOk(username, burger)).toBe(
			"alice, показываю рецепт: Бургер (Нижняя булочка, Котлета, Сыр, Верхняя булочка).",
		);
	});

	it("formats next-dish replies", () => {
		expect(replyNextAck(username)).toBe(
			"alice запечатал блюдо, поднос чистый.",
		);
		expect(replyNextLastItem(username)).toBe(
			"alice, это последнее блюдо заказа — отдавай через !serve.",
		);
		expect(replyNextTrayEmpty(username)).toBe(
			"alice, поднос пуст — нечего запечатывать.",
		);
	});
});
