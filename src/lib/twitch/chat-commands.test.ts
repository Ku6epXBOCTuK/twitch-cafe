import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IOrder } from "../core/types/order";
import { ORDER_STATUS } from "../core/types/order";
import { MENU_ITEMS } from "../core/data/menu";
import { SessionManager } from "../core/game/session-manager";
import { connectSim } from "../sim/sync";
import { processMessage } from "./chat-commands";

const burger = MENU_ITEMS.find((m) => m.id === "burger")!;

function fixedBurgerOrder(): IOrder {
	return {
		id: `o-${Math.random().toString(36).slice(2)}`,
		items: [burger],
		customer: { id: "normal", name: "Обычный", strictness: 0.5 },
		timeLimit: 90_000,
		createdAt: new Date(0),
		status: ORDER_STATUS.PENDING,
	};
}

function setup() {
	const sm = new SessionManager(fixedBurgerOrder);
	connectSim(sm);
	return sm;
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("беседа: полный игровой цикл", () => {
	it("!join → сборка → !serve оценивает, XP начисляется, следующий заказ", () => {
		const sm = setup();
		const alice = "alice";

		const join = processMessage("!join", alice, sm);
		expect(join).toContain("Обычный заказал");
		expect(join).toContain("Бургер");
		expect(join).toContain("90 сек");
		expect(sm.getXp(alice)).toBe(0);

		// serve пустого подноса — отказ
		expect(processMessage("!serve", alice, sm)).toContain("поднос пуст");

		// перепутанный порядок начинки: сыр раньше котлеты
		processMessage("!put нижняя булочка", alice, sm);
		expect(processMessage("!put сыр", alice, sm)).toContain("положил: Сыр");
		processMessage("!put котлета", alice, sm);
		processMessage("!put верхняя булочка", alice, sm);

		const serve = processMessage("!serve", alice, sm)!;
		expect(serve).toContain("Хорошо!");
		expect(serve).toContain("порядок начинки нарушен");
		expect(serve).toContain("Следующий заказ");
		expect(sm.getXp(alice)).toBe(30);
	});

	it("!bin сбрасывает поднос, идеальная сборка даёт perfect и +50 XP", () => {
		const sm = setup();
		const alice = "alice";
		processMessage("!join", alice, sm);

		for (const id of ["bun_bottom", "patty", "cheese", "bun_top"]) {
			processMessage(`!put ${id}`, alice, sm);
		}
		const serve = processMessage("!serve", alice, sm)!;
		expect(serve).toContain("Идеально!");
		expect(serve).toContain("+50 XP");
		expect(sm.getXp(alice)).toBe(50);

		// следующий заказ — поднос снова пуст
		expect(processMessage("!menu", alice, sm)).toContain("Поднос: пуст");
	});

	it("неизвестный ингредиент и повторный join", () => {
		const sm = setup();
		const alice = "alice";

		expect(processMessage("!join", alice, sm)).toContain("заказал");
		expect(processMessage("!join", alice, sm)).toContain("уже в игре");
		expect(processMessage("!put железо", alice, sm)).toContain(
			"нет такого ингредиента",
		);
	});

	it("не игрок получает отказ", () => {
		const sm = setup();
		expect(processMessage("!put сыр", "bob", sm)).toContain("не в игре");
		expect(processMessage("!serve", "bob", sm)).toContain("не в игре");
	});

	it("не-команда игнорируется", () => {
		const sm = setup();
		expect(processMessage("привет всем", "bob", sm)).toBeNull();
		expect(processMessage("", "bob", sm)).toBeNull();
	});

	it("таймаут заказа — XP в минус через connectSim", () => {
		const sm = setup();
		const alice = "alice";
		processMessage("!join", alice, sm);
		const order = sm.getOrder(alice)!;

		vi.advanceTimersByTime(order.timeLimit + 1);
		expect(order.status).toBe("EXPIRED");
		expect(sm.getXp(alice)).toBe(-50);
		expect(sm.getOrder(alice)).not.toBe(order);
	});
});
