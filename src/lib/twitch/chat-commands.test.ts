import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import { SessionManager } from "../core/game/session-manager";
import type { IOrder } from "../core/types/order";
import { ORDER_STATUS } from "../core/types/order";
import { burger, BURGER_IDS, cola, makeOrder } from "#lib/test-support";
import { connectSim } from "../sim/sync";
import { project } from "../overlay/projector";
import { processMessage } from "./chat-commands";
import { ListSink } from "./command-sink";

const fixedBurgerOrder = (): IOrder =>
	makeOrder({ id: "burger-order", items: [burger] });
const fixedBurgerColaOrder = (): IOrder =>
	makeOrder({ id: "burger-cola-order", items: [burger, cola] });
const fixedColaOrder = (): IOrder =>
	makeOrder({ id: "cola-order", items: [cola] });

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

function expectReply(sink: ListSink): void {
	expect(sink.messages).toHaveLength(1);
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
		warmup(sm);
		const res = sm.takeOrder(alice, 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);
		expect(res.order.status).toBe(ORDER_STATUS.PENDING);
		expectReply(send(sm, "!menu"));
		expect(sm.getXp(alice)).toBe(0);

		const xpBeforeServe = sm.getXp(alice);
		expectReply(send(sm, "!serve"));
		expect(sm.getXp(alice)).toBe(xpBeforeServe);

		processMessage("!put нижняя булочка", alice, sm, new ListSink());
		expectReply(send(sm, "!put сыр"));
		processMessage("!put котлета", alice, sm, new ListSink());
		processMessage("!put верхняя булочка", alice, sm, new ListSink());

		expectReply(send(sm, "!serve"));
		const result = sm.getLastResult(alice);
		expect(result).not.toBeNull();
		expect(result?.orderIssues.length).toBeGreaterThan(0);
		expect(sm.getXp(alice)).toBe(result?.xpDelta);
	});

	it("идеальная сборка завершает заказ и начисляет XP, авто-выдачи нет", () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		sm.takeOrder(alice, 0);

		for (const id of BURGER_IDS) {
			processMessage(`!put ${id}`, alice, sm, new ListSink());
		}
		expectReply(send(sm, "!serve"));
		const result = sm.getLastResult(alice);
		expect(result).not.toBeNull();
		expect(sm.getXp(alice)).toBe(result?.xpDelta);

		warmup(sm);
		const res = sm.takeOrder(alice, 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);
		expect(res.order.status).toBe(ORDER_STATUS.PENDING);
		expectReply(send(sm, "!menu"));
		expect(sm.getTraySnapshot(alice)?.layers).toEqual([]);
	});

	it("!bin сбрасывает поднос в мусорку", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);

		processMessage("!put сыр", "alice", sm, new ListSink());
		expectReply(send(sm, "!bin"));
		expect(sm.getTraySnapshot("alice")?.layers).toEqual([]);
		expectReply(send(sm, "!menu"));
	});

	it("повторное взятие при активном заказе — busy", () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		sm.takeOrder(alice, 0);

		expectReply(send(sm, "!взять 2"));
		expectReply(send(sm, "!put железо"));
	});

	it("не игрок получает отказ", () => {
		const sm = setup();
		warmup(sm);
		expectReply(send(sm, "!взять 3", "bob"));
		expectReply(send(sm, "!put сыр", "bob"));
		expectReply(send(sm, "!serve", "bob"));
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
		expect(res.order.status).toBe(ORDER_STATUS.EXPIRED);
		expect(sm.getXp(alice)).toBeLessThan(0);
		expect(sm.getOrder(alice)).toBe(res.order);
	});
});

it("после serve новый заказ виден в !заказ и на execution-мониторе", () => {
	const orders = [fixedBurgerOrder(), fixedColaOrder()];
	const sm = setup(() => orders.shift()!);
	const alice = "alice";
	warmup(sm);

	expectReply(send(sm, "!взять 1", alice));
	for (const id of BURGER_IDS) {
		processMessage(`!put ${id}`, alice, sm, new ListSink());
	}
	expectReply(send(sm, "!serve", alice));
	expectReply(send(sm, "!заказ", alice));
	expectReply(send(sm, "!next", alice));

	sm.incomingOrders.spawn();
	expectReply(send(sm, "!взять 1", alice));

	const activeOrder = sm.getActiveOrder(alice);
	expect(activeOrder?.items.map((entry) => entry.item.id)).toEqual([cola.id]);
	expectReply(send(sm, "!заказ", alice));

	const execution = project(sm).execution;
	expect(execution).toHaveLength(1);
	expect(execution[0].id).toBe(activeOrder?.id);
	expect(execution[0].dishes).toEqual([{ name: cola.name, done: false }]);
});

describe("беседа: !взять", () => {
	it("берёт заказ из слота и показывает его описание", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);

		expectReply(send(sm, "!взять 1"));
		expect(
			sm.getActiveOrder("alice")?.items.map((entry) => entry.item.id),
		).toEqual([burger.id, cola.id]);
		expect(sm.hasSession("alice")).toBe(true);
	});

	it("!взять без номера — подсказка", () => {
		const sm = setup();
		expectReply(send(sm, "!взять"));
	});

	it("!взять abc — подсказка", () => {
		const sm = setup();
		expectReply(send(sm, "!взять abc"));
	});

	it("!взять на пустой слот — отказ", () => {
		const sm = setup();
		warmup(sm);
		expectReply(send(sm, "!взять 3"));
	});

	it("алиас !take работает", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		sm.incomingOrders.spawn(); // второй слот
		expectReply(send(sm, "!take 2"));
		expect(sm.getActiveOrder("alice")?.id).toBeDefined();
	});
});

describe("беседа: полный цикл с !next (два блюда)", () => {
	it("!взять → бургер → !next → кола → !serve → снова свободен", () => {
		const sm = setup(fixedBurgerColaOrder);
		const alice = "alice";
		warmup(sm);

		expectReply(send(sm, "!взять 1"));

		for (const id of BURGER_IDS) {
			processMessage(`!put ${id}`, alice, sm, new ListSink());
		}
		expectReply(send(sm, "!next"));
		expect(sm.getTraySnapshot(alice)?.layers).toEqual([]);

		processMessage("!put кола", alice, sm, new ListSink());
		expectReply(send(sm, "!serve"));
		const result = sm.getLastResult(alice);
		expect(result).not.toBeNull();
		expect(sm.getXp(alice)).toBe(result?.xpDelta);

		warmup(sm);
		sm.incomingOrders.spawn();
		expectReply(send(sm, "!взять 2"));
	});

	it("!next без заказа — «не в игре»", () => {
		const sm = setup();
		expectReply(send(sm, "!next", "bob"));
	});

	it("!next на последнем блюде — отказ", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);

		processMessage("!put сыр", "alice", sm, new ListSink());
		expectReply(send(sm, "!next"));
	});

	it("!next на пустом подносе — отказ", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		sm.takeOrder("alice", 0);
		expectReply(send(sm, "!next"));
	});
});

describe("беседа: !рецепт", () => {
	it("показывает рецепт и запоминает его в RecipeBook", () => {
		const sm = setup();
		expectReply(send(sm, "!рецепт бургер"));
		expect(sm.recipeBook.getCurrent()?.id).toBe(burger.id);
	});

	it("!рецепт без аргумента — подсказка", () => {
		const sm = setup();
		expectReply(send(sm, "!рецепт"));
	});

	it("неизвестное блюдо — отказ", () => {
		const sm = setup();
		expectReply(send(sm, "!рецепт абракадабра"));
	});
});

describe("беседа: алиасы !заказ/!order", () => {
	it("работают как !menu", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);
		expectReply(send(sm, "!заказ"));
		expectReply(send(sm, "!order"));
	});
});
