import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import { INGREDIENTS } from "../core/data/menu";
import type { GameEvent } from "../core/game/game-event";
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

function warmup(_sm: SessionManager): void {
	vi.advanceTimersByTime(ORDER_CONFIG.SPAWN_INTERVAL_MS);
}

function runMessage(
	raw: string,
	username: string,
	sm: SessionManager,
	sink: ListSink,
): void {
	Effect.runSync(processMessage(raw, username, sm, sink));
}

function send(sm: SessionManager, raw: string, username = "alice"): ListSink {
	const sink = new ListSink();
	runMessage(raw, username, sm, sink);
	return sink;
}

function expectEvent(sink: ListSink, type: GameEvent["type"]): GameEvent {
	expect(sink.events).toHaveLength(1);
	const event = sink.events[0];
	expect(event?.type).toBe(type);
	expect(event?.correlationId).toMatch(/^command-\d+$/);
	if (!event) throw new Error("Expected a game event");
	return event;
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

		const menu = expectEvent(send(sm, "!menu"), "menu_state");
		expect(menu.type === "menu_state" && menu.order.id).toBe(res.order.id);
		expect(sm.getXp(alice)).toBe(0);

		const xpBeforeServe = sm.getXp(alice);
		const empty = expectEvent(send(sm, "!serve"), "tray_empty");
		expect(empty.type === "tray_empty" && empty.operation).toBe("serve");
		expect(sm.getXp(alice)).toBe(xpBeforeServe);

		runMessage("!put нижняя булочка", alice, sm, new ListSink());
		const ingredient = expectEvent(send(sm, "!put сыр"), "ingredient_added");
		expect(
			ingredient.type === "ingredient_added" && ingredient.ingredientId,
		).toBe(INGREDIENTS.cheese.id);
		runMessage("!put котлета", alice, sm, new ListSink());
		runMessage("!put верхняя булочка", alice, sm, new ListSink());

		const served = expectEvent(send(sm, "!serve"), "order_served");
		expect(served.type === "order_served" && served.order.id).toBe(
			res.order.id,
		);
		expect(
			served.type === "order_served" && served.assessment.orderIssues.length,
		).toBeGreaterThan(0);
		expect(sm.getXp(alice)).toBe(
			served.type === "order_served" ? served.assessment.xpDelta : undefined,
		);
	});

	it("идеальная сборка завершает заказ и начисляет XP, авто-выдачи нет", () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		sm.takeOrder(alice, 0);

		for (const id of BURGER_IDS) {
			runMessage(`!put ${id}`, alice, sm, new ListSink());
		}
		const served = expectEvent(send(sm, "!serve"), "order_served");
		expect(served.type === "order_served" && served.order.status).toBe(
			ORDER_STATUS.COMPLETED,
		);
		expect(sm.getXp(alice)).toBe(
			served.type === "order_served" ? served.assessment.xpDelta : undefined,
		);

		warmup(sm);
		const res = sm.takeOrder(alice, 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);
		const menu = expectEvent(send(sm, "!menu"), "menu_state");
		expect(menu.type === "menu_state" && menu.trayLayers).toEqual([]);
	});

	it("!bin очищает поднос", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);

		runMessage("!put сыр", "alice", sm, new ListSink());
		expectEvent(send(sm, "!bin"), "tray_cleared");
		expect(sm.getTraySnapshot("alice")?.layers).toEqual([]);
		expectEvent(send(sm, "!menu"), "menu_state");
	});

	it("повторное взятие при активном заказе — busy", () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		sm.takeOrder(alice, 0);

		const busy = expectEvent(send(sm, "!взять 2"), "busy");
		expect(busy.type === "busy" && busy.operation).toBe("take");
		const unknown = expectEvent(send(sm, "!put железо"), "unknown_ingredient");
		expect(unknown.type === "unknown_ingredient" && unknown.token).toBe(
			"железо",
		);
	});

	it("не игрок получает отказ", () => {
		const sm = setup();
		warmup(sm);
		expectEvent(send(sm, "!взять 3", "bob"), "empty_slot");
		expectEvent(send(sm, "!put сыр", "bob"), "not_in_game");
		expectEvent(send(sm, "!serve", "bob"), "not_in_game");
	});

	it("не скрывает defect: ошибка команды не превращается в GameEvent", () => {
		const sm = setup();
		vi.spyOn(sm, "serveEffect").mockReturnValue(Effect.die(new Error("boom")));
		const sink = new ListSink();
		const exit = Effect.runSyncExit(
			processMessage("!serve", "alice", sm, sink),
		);

		expect(exit._tag).toBe("Failure");
		expect(sink.events).toEqual([]);
	});

	it("не-команда игнорируется: sink нетронут", () => {
		const sm = setup();
		expect(send(sm, "привет всем", "bob").events).toEqual([]);
		expect(send(sm, "", "bob").events).toEqual([]);
		expect(send(sm, "!join", "bob").events).toEqual([]);
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

	expectEvent(send(sm, "!взять 1", alice), "order_taken");
	for (const id of BURGER_IDS) {
		runMessage(`!put ${id}`, alice, sm, new ListSink());
	}
	expectEvent(send(sm, "!serve", alice), "order_served");
	expectEvent(send(sm, "!заказ", alice), "no_active_order");
	expectEvent(send(sm, "!next", alice), "no_active_order");

	sm.incomingOrders.spawn();
	expectEvent(send(sm, "!взять 1", alice), "order_taken");

	const activeOrder = sm.getActiveOrder(alice);
	expect(activeOrder?.items.map((entry) => entry.item.id)).toEqual([cola.id]);
	expectEvent(send(sm, "!заказ", alice), "menu_state");

	const execution = project(sm).execution;
	expect(execution).toHaveLength(1);
	expect(execution[0].id).toBe(activeOrder?.id);
	expect(execution[0].dishes).toEqual([{ name: cola.name, done: false }]);
});

describe("беседа: !взять", () => {
	it("берёт заказ из слота и показывает его состояние", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);

		const event = expectEvent(send(sm, "!взять 1"), "order_taken");
		expect(event.type === "order_taken" && event.slot).toBe(1);
		expect(
			event.type === "order_taken" &&
				event.order.items.map((entry) => entry.item.id),
		).toEqual([burger.id, cola.id]);
	});

	it("!взять сохраняет timeout после завершения Effect", () => {
		const sm = setup();
		warmup(sm);
		const event = expectEvent(send(sm, "!взять 1"), "order_taken");
		if (event.type !== "order_taken") throw new Error("Expected order_taken");

		vi.advanceTimersByTime(event.order.timeLimit + 1);
		expect(sm.getOrder("alice")?.status).toBe(ORDER_STATUS.EXPIRED);
	});

	it("!взять без номера — slot_required", () => {
		const sm = setup();
		expectEvent(send(sm, "!взять"), "slot_required");
	});

	it("!взять abc — slot_required", () => {
		const sm = setup();
		expectEvent(send(sm, "!взять abc"), "slot_required");
	});

	it("!взять на пустой слот — empty_slot", () => {
		const sm = setup();
		warmup(sm);
		const event = expectEvent(send(sm, "!взять 3"), "empty_slot");
		expect(event.type === "empty_slot" && event.slot).toBe(3);
	});

	it("алиас !take работает", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		sm.incomingOrders.spawn();
		const event = expectEvent(send(sm, "!take 2"), "order_taken");
		expect(event.type === "order_taken" && event.slot).toBe(2);
	});
});

describe("беседа: полный цикл с !next (два блюда)", () => {
	it("!взять → бургер → !next → кола → !serve → снова свободен", () => {
		const sm = setup(fixedBurgerColaOrder);
		const alice = "alice";
		warmup(sm);

		expectEvent(send(sm, "!взять 1"), "order_taken");
		for (const id of BURGER_IDS) {
			runMessage(`!put ${id}`, alice, sm, new ListSink());
		}

		const sealed = expectEvent(send(sm, "!next"), "dish_sealed");
		expect(sealed.type === "dish_sealed" && sealed.sealedLayers).toEqual(
			BURGER_IDS,
		);
		expect(sealed.type === "dish_sealed" && sealed.nextItemIndex).toBe(1);
		expect(sm.getTraySnapshot(alice)?.layers).toEqual([]);

		runMessage("!put кола", alice, sm, new ListSink());
		const served = expectEvent(send(sm, "!serve"), "order_served");
		expect(sm.getXp(alice)).toBe(
			served.type === "order_served" ? served.assessment.xpDelta : undefined,
		);

		warmup(sm);
		sm.incomingOrders.spawn();
		expectEvent(send(sm, "!взять 2"), "order_taken");
	});

	it("!next без заказа — not_in_game", () => {
		const sm = setup();
		expectEvent(send(sm, "!next", "bob"), "not_in_game");
	});

	it("!next на последнем блюде — last_item", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);
		runMessage("!put сыр", "alice", sm, new ListSink());
		expectEvent(send(sm, "!next"), "last_item");
	});

	it("!next на пустом подносе — tray_empty", () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		sm.takeOrder("alice", 0);
		const event = expectEvent(send(sm, "!next"), "tray_empty");
		expect(event.type === "tray_empty" && event.operation).toBe("next");
	});
});

describe("беседа: !рецепт", () => {
	it("показывает рецепт и запоминает его в RecipeBook", () => {
		const sm = setup();
		const event = expectEvent(send(sm, "!рецепт бургер"), "recipe_shown");
		expect(event.type === "recipe_shown" && event.item.id).toBe(burger.id);
		expect(sm.recipeBook.getCurrent()?.id).toBe(burger.id);
	});

	it("!рецепт без аргумента — recipe_arg_required", () => {
		const sm = setup();
		expectEvent(send(sm, "!рецепт"), "recipe_arg_required");
	});

	it("неизвестное блюдо — recipe_unknown", () => {
		const sm = setup();
		const event = expectEvent(
			send(sm, "!рецепт абракадабра"),
			"recipe_unknown",
		);
		expect(event.type === "recipe_unknown" && event.token).toBe("абракадабра");
	});
});

describe("беседа: алиасы !заказ/!order", () => {
	it("работают как !menu", () => {
		const sm = setup();
		warmup(sm);
		sm.takeOrder("alice", 0);
		expectEvent(send(sm, "!заказ"), "menu_state");
		expectEvent(send(sm, "!order"), "menu_state");
	});
});
