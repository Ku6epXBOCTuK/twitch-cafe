import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import { MENU_ITEMS } from "../core/data/menu";
import { SessionManager } from "../core/game/session-manager";
import type { IOrder } from "../core/types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../core/types/order";
import { connectSim } from "../sim/sync";
import { processMessage } from "./chat-commands";
import { ListSink } from "./command-sink";

const burger = MENU_ITEMS.find((m) => m.id === "burger")!;
const cola = MENU_ITEMS.find((m) => m.id === "cola")!;

function fixedBurgerOrder(): IOrder {
	return {
		id: `o-${Math.random().toString(36).slice(2)}`,
		items: [{ item: burger, state: ORDER_ITEM_STATE.PENDING }],
		customer: { id: "normal", name: "Обычный", strictness: 0.5 },
		timeLimit: 90_000,
		createdAt: new Date(0),
		status: ORDER_STATUS.PENDING,
	};
}

function fixedBurgerColaOrder(): IOrder {
	return {
		id: `o-${Math.random().toString(36).slice(2)}`,
		items: [
			{ item: burger, state: ORDER_ITEM_STATE.PENDING },
			{ item: cola, state: ORDER_ITEM_STATE.PENDING },
		],
		customer: { id: "normal", name: "Обычный", strictness: 0.5 },
		timeLimit: 90_000,
		createdAt: new Date(0),
		status: ORDER_STATUS.PENDING,
	};
}

function setup(makeOrder: () => IOrder = fixedBurgerOrder): SessionManager {
	const sm = new SessionManager(makeOrder);
	connectSim(sm);
	sm.incomingOrders.start();
	return sm;
}

/** Прогрев спавна. */
function warmup(_sm: SessionManager): void {
	vi.advanceTimersByTime(ORDER_CONFIG.SPAWN_INTERVAL_MS);
}

function send(sm: SessionManager, raw: string, username = "alice"): ListSink {
	const sink = new ListSink();
	processMessage(raw, username, sm, sink);
	return sink;
}

const BURGER_IDS = ["bun_bottom", "patty", "cheese", "bun_top"];

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
		warmup(sm);
		const res = sm.takeOrder(alice, 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);
		expect(res.order.status).toBe(ORDER_STATUS.PENDING);
		expect(send(sm, "!menu").messages[0]).toContain("Бургер");
		expect(sm.getXp(alice)).toBe(0);

		// serve пустого подноса — отказ
		expect(send(sm, "!serve").messages[0]).toContain("поднос пуст");

		// перепутанный порядок начинки: сыр раньше котлеты
		processMessage("!put нижняя булочка", alice, sm, new ListSink());
		expect(send(sm, "!put сыр").messages[0]).toContain("положил: Сыр");
		processMessage("!put котлета", alice, sm, new ListSink());
		processMessage("!put верхняя булочка", alice, sm, new ListSink());

		const serve = send(sm, "!serve").messages[0];
		expect(serve).toContain("Хорошо!");
		expect(serve).toContain("порядок начинки нарушен");
		expect(sm.getXp(alice)).toBe(30);
	});

	it("идеальная сборка даёт perfect и +50 XP, авто-выдачи нет", () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		sm.takeOrder(alice, 0);

		for (const id of BURGER_IDS) {
			processMessage(`!put ${id}`, alice, sm, new ListSink());
		}
		const serve = send(sm, "!serve").messages[0];
		expect(serve).toContain("Идеально!");
		expect(serve).toContain("+50 XP");
		expect(serve).not.toContain("Следующий заказ"); // авто-выдачи нет
		expect(sm.getXp(alice)).toBe(50);

		// после serve заказ закрыт; поднос очищается только при новом взятии
		warmup(sm);
		const res = sm.takeOrder(alice, 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);
		expect(res.order.status).toBe(ORDER_STATUS.PENDING);
		expect(send(sm, "!menu").messages[0]).toContain("Поднос: пуст");
	});

	it("!bin сбрасывает поднос в мусорку", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);

		processMessage("!put сыр", "alice", sm, new ListSink());
		expect(send(sm, "!bin").messages[0]).toContain("сбросил");
		expect(send(sm, "!menu").messages[0]).toContain("Поднос: пуст");
	});

	it("повторное взятие при активном заказе — busy", () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		sm.takeOrder(alice, 0);

		expect(send(sm, "!взять 2").messages[0]).toContain("уже есть заказ");
		expect(send(sm, "!put железо").messages[0]).toContain(
			"нет такого ингредиента",
		);
	});

	it("не игрок получает отказ", () => {
		const sm = setup();
		warmup(sm);
		expect(send(sm, "!взять 3", "bob").messages[0]).toContain("слот пуст");
		expect(send(sm, "!put сыр", "bob").messages[0]).toContain("не в игре");
		expect(send(sm, "!serve", "bob").messages[0]).toContain("не в игре");
	});

	it("не-команда игнорируется: sink нетронут", () => {
		const sm = setup();
		expect(send(sm, "привет всем", "bob").messages).toEqual([]);
		expect(send(sm, "", "bob").messages).toEqual([]);
		expect(send(sm, "!join", "bob").messages).toEqual([]);
	});

	it("таймаут заказа — XP в минус, авто-выдачи нет", () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		const res = sm.takeOrder(alice, 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);

		vi.advanceTimersByTime(res.order.timeLimit + 1);
		expect(res.order.status).toBe("EXPIRED");
		expect(sm.getXp(alice)).toBe(-50);
		expect(sm.getOrder(alice)).toBe(res.order);
	});
});

describe("беседа: !взять", () => {
	it("берёт заказ из слота и показывает его описание", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);

		const reply = send(sm, "!взять 1").messages[0];
		expect(reply).toContain("взял заказ №1");
		expect(reply).toContain("Бургер");
		expect(reply).toContain("Кола");
		expect(sm.hasSession("alice")).toBe(true);
	});

	it("!взять без номера — подсказка", () => {
		const sm = setup();
		expect(send(sm, "!взять").messages[0]).toContain("номер слота 1–3");
	});

	it("!взять abc — подсказка", () => {
		const sm = setup();
		expect(send(sm, "!взять abc").messages[0]).toContain("номер слота 1–3");
	});

	it("!взять на пустой слот — отказ", () => {
		const sm = setup();
		warmup(sm);
		expect(send(sm, "!взять 3").messages[0]).toContain("слот пуст");
	});

	it("алиас !take работает", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		sm.incomingOrders.spawn(); // второй слот
		expect(send(sm, "!take 2").messages[0]).toContain("взял заказ №2");
	});
});

describe("беседа: полный цикл с !next (два блюда)", () => {
	it("!взять → бургер → !next → кола → !serve → снова свободен", () => {
		const sm = setup(fixedBurgerColaOrder);
		const alice = "alice";
		warmup(sm);

		expect(send(sm, "!взять 1").messages[0]).toContain("взял заказ №1");

		for (const id of BURGER_IDS) {
			processMessage(`!put ${id}`, alice, sm, new ListSink());
		}
		expect(send(sm, "!next").messages[0]).toContain("запечатал");
		expect(send(sm, "!menu").messages[0]).toContain("Поднос: пуст");

		processMessage("!put кола", alice, sm, new ListSink());
		const serve = send(sm, "!serve").messages[0];
		expect(serve).toContain("Идеально!");
		expect(serve).toContain("+50 XP");

		// снова свободен: берёт другой слот сам
		warmup(sm);
		sm.incomingOrders.spawn(); // второй слот
		expect(send(sm, "!взять 2").messages[0]).toContain("взял заказ №2");
	});

	it("!next без заказа — «не в игре»", () => {
		const sm = setup();
		expect(send(sm, "!next", "bob").messages[0]).toContain("не в игре");
	});

	it("!next на последнем блюде — отказ", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);

		processMessage("!put сыр", "alice", sm, new ListSink());
		expect(send(sm, "!next").messages[0]).toContain("последнее блюдо");
	});

	it("!next на пустом подносе — отказ", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		sm.takeOrder("alice", 0);
		expect(send(sm, "!next").messages[0]).toContain("нечего запечатывать");
	});
});

describe("беседа: !рецепт", () => {
	it("показывает рецепт и запоминает его в RecipeBook", () => {
		const sm = setup();
		expect(send(sm, "!рецепт бургер").messages[0]).toContain(
			"показываю рецепт",
		);
		expect(sm.recipeBook.getCurrent()?.id).toBe("burger");
	});

	it("!рецепт без аргумента — подсказка", () => {
		const sm = setup();
		expect(send(sm, "!рецепт").messages[0]).toContain("напиши название блюда");
	});

	it("неизвестное блюдо — отказ", () => {
		const sm = setup();
		expect(send(sm, "!рецепт абракадабра").messages[0]).toContain(
			"нет такого блюда",
		);
	});
});

describe("беседа: алиасы !заказ/!order", () => {
	it("работают как !menu", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);
		expect(send(sm, "!заказ").messages[0]).toContain("заказ — Бургер");
		expect(send(sm, "!order").messages[0]).toContain("заказ — Бургер");
	});
});
