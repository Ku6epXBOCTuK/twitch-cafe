import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IOrder } from "../core/types/order";
import { ORDER_STATUS } from "../core/types/order";
import { MENU_ITEMS } from "../core/data/menu";
import { ORDER_CONFIG } from "../core/config";
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
	sm.incomingOrders.start();
	return sm;
}

/** Прогрев спавна + взятие заказа из слота (команда взятия появится в O2). */
function takeOrder(sm: SessionManager, username: string, slot = 0): IOrder {
	vi.advanceTimersByTime(ORDER_CONFIG.SPAWN_INTERVAL_MS);
	const res = sm.takeOrder(username, slot);
	if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);
	return res.order;
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("беседа: полный игровой цикл", () => {
	it("взятие заказа → сборка → !serve оценивает и начисляет XP", () => {
		const sm = setup();
		const alice = "alice";

		const order = takeOrder(sm, alice);
		expect(order.status).toBe(ORDER_STATUS.PENDING);
		expect(processMessage("!menu", alice, sm)).toContain("Бургер");
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
		expect(sm.getXp(alice)).toBe(30);
	});

	it("идеальная сборка даёт perfect и +50 XP, авто-выдачи нет", () => {
		const sm = setup();
		const alice = "alice";
		takeOrder(sm, alice);

		for (const id of ["bun_bottom", "patty", "cheese", "bun_top"]) {
			processMessage(`!put ${id}`, alice, sm);
		}
		const serve = processMessage("!serve", alice, sm)!;
		expect(serve).toContain("Идеально!");
		expect(serve).toContain("+50 XP");
		expect(serve).not.toContain("Следующий заказ"); // авто-выдачи нет
		expect(sm.getXp(alice)).toBe(50);

		// после serve заказ закрыт; поднос очищается только при новом взятии
		const next = takeOrder(sm, alice);
		expect(next.status).toBe(ORDER_STATUS.PENDING);
		expect(processMessage("!menu", alice, sm)).toContain("Поднос: пуст");
	});

	it("!bin сбрасывает поднос в мусорку", () => {
		const sm = setup();
		const alice = "alice";
		takeOrder(sm, alice);

		processMessage("!put сыр", alice, sm);
		expect(processMessage("!bin", alice, sm)).toContain("сбросил");
		expect(processMessage("!menu", alice, sm)).toContain("Поднос: пуст");
	});

	it("повторное взятие при активном заказе — busy", () => {
		const sm = setup();
		const alice = "alice";

		takeOrder(sm, alice);
		expect(sm.takeOrder(alice, 1)).toEqual({ ok: false, reason: "busy" });
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
		expect(processMessage("!join", "bob", sm)).toBeNull();
	});

	it("таймаут заказа — XP в минус, авто-выдачи нет", () => {
		const sm = setup();
		const alice = "alice";
		const order = takeOrder(sm, alice);

		vi.advanceTimersByTime(order.timeLimit + 1);
		expect(order.status).toBe("EXPIRED");
		expect(sm.getXp(alice)).toBe(-50);
		expect(sm.getOrder(alice)).toBe(order);
	});
});
