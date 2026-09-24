import { Clock, Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import { INGREDIENTS } from "../core/data/menu";
import type { GameEvent } from "../core/game/game-event";
import { SessionManager } from "../core/game/session-manager";
import { DEFAULT_GAME_CONFIG, GameConfig } from "../core/game/game-config";
import type { IOrder } from "../core/types/order";
import { ORDER_STATUS } from "../core/types/order";
import { burger, BURGER_IDS, cola, makeOrder } from "#lib/test-support";
import { connectSim } from "../sim/sync";
import { projectSnapshot } from "../overlay/projector";
import { processMessage } from "./chat-commands";
import { ListSink } from "./command-sink";

const fixedBurgerOrder = (): IOrder =>
	makeOrder({ id: "burger-order", items: [burger] });
const fixedBurgerColaOrder = (): IOrder =>
	makeOrder({ id: "burger-cola-order", items: [burger, cola] });
const fixedColaOrder = (): IOrder =>
	makeOrder({ id: "cola-order", items: [cola] });

const activeManagers = new Set<SessionManager>();

function runGameSync<A, E>(effect: Effect.Effect<A, E>): A {
	return Effect.runSync(
		Effect.provideService(
			Effect.provideService(effect, GameConfig, DEFAULT_GAME_CONFIG),
			Clock.Clock,
			Clock.Clock.defaultValue(),
		),
	);
}

function setup(makeOrder: () => IOrder = fixedBurgerOrder): SessionManager {
	const sm = new SessionManager(makeOrder);
	connectSim(sm);
	activeManagers.add(sm);
	runGameSync(sm.startEffect());
	return sm;
}

function takeOrder(sm: SessionManager, username: string, slot = 0): IOrder {
	return runGameSync(sm.takeOrderEffect(username, slot));
}

function warmup(_sm: SessionManager): void {
	vi.advanceTimersByTime(ORDER_CONFIG.SPAWN_INTERVAL_MS);
}

async function runMessage(
	raw: string,
	username: string,
	sm: SessionManager,
	sink: ListSink,
): Promise<void> {
	await Effect.runPromise(
		Effect.provideService(
			Effect.provideService(
				processMessage(raw, username, sm, sink),
				GameConfig,
				DEFAULT_GAME_CONFIG,
			),
			Clock.Clock,
			Clock.Clock.defaultValue(),
		),
	);
}

async function send(
	sm: SessionManager,
	raw: string,
	username = "alice",
): Promise<ListSink> {
	const sink = new ListSink();
	await runMessage(raw, username, sm, sink);
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
	for (const sm of activeManagers) {
		Effect.runSync(sm.stopEffect());
	}
	activeManagers.clear();
	vi.useRealTimers();
});

describe("беседа: полный игровой цикл", () => {
	it("взятие заказа → сборка → !serve оценивает и начисляет XP", async () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		const order = takeOrder(sm, alice, 0);
		expect(order.status).toBe(ORDER_STATUS.PENDING);

		const menu = expectEvent(await send(sm, "!menu"), "menu_state");
		expect(menu.type === "menu_state" && menu.order.id).toBe(order.id);
		expect(sm.getXp(alice)).toBe(0);

		const xpBeforeServe = sm.getXp(alice);
		const empty = expectEvent(await send(sm, "!serve"), "tray_empty");
		expect(empty.type === "tray_empty" && empty.operation).toBe("serve");
		expect(sm.getXp(alice)).toBe(xpBeforeServe);

		await runMessage("!put нижняя булочка", alice, sm, new ListSink());
		const ingredient = expectEvent(
			await send(sm, "!put сыр"),
			"ingredient_added",
		);
		expect(
			ingredient.type === "ingredient_added" && ingredient.ingredientId,
		).toBe(INGREDIENTS.cheese.id);
		await runMessage("!put котлета", alice, sm, new ListSink());
		await runMessage("!put верхняя булочка", alice, sm, new ListSink());

		const served = expectEvent(await send(sm, "!serve"), "order_served");
		expect(served.type === "order_served" && served.order.id).toBe(order.id);
		expect(
			served.type === "order_served" && served.assessment.orderIssues.length,
		).toBeGreaterThan(0);
		expect(sm.getXp(alice)).toBe(
			served.type === "order_served" ? served.assessment.xpDelta : undefined,
		);
	});

	it("идеальная сборка завершает заказ и начисляет XP, авто-выдачи нет", async () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		takeOrder(sm, alice, 0);

		for (const id of BURGER_IDS) {
			await runMessage(`!put ${id}`, alice, sm, new ListSink());
		}
		const served = expectEvent(await send(sm, "!serve"), "order_served");
		expect(served.type === "order_served" && served.order.status).toBe(
			ORDER_STATUS.COMPLETED,
		);
		expect(sm.getXp(alice)).toBe(
			served.type === "order_served" ? served.assessment.xpDelta : undefined,
		);

		warmup(sm);
		takeOrder(sm, alice, 0);
		const menu = expectEvent(await send(sm, "!menu"), "menu_state");
		expect(menu.type === "menu_state" && menu.trayLayers).toEqual([]);
	});

	it("!bin очищает поднос", async () => {
		const sm = setup();
		warmup(sm);
		takeOrder(sm, "alice", 0);

		await runMessage("!put сыр", "alice", sm, new ListSink());
		expectEvent(await send(sm, "!bin"), "tray_cleared");
		expect(sm.getTraySnapshot("alice")?.layers).toEqual([]);
		expectEvent(await send(sm, "!menu"), "menu_state");
	});

	it("повторное взятие при активном заказе — busy", async () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		takeOrder(sm, alice, 0);

		const busy = expectEvent(await send(sm, "!взять 2"), "busy");
		expect(busy.type === "busy" && busy.operation).toBe("take");
		const unknown = expectEvent(
			await send(sm, "!put железо"),
			"unknown_ingredient",
		);
		expect(unknown.type === "unknown_ingredient" && unknown.token).toBe(
			"железо",
		);
	});

	it("не игрок получает отказ", async () => {
		const sm = setup();
		expectEvent(await send(sm, "!взять 3", "bob"), "empty_slot");
		expectEvent(await send(sm, "!put сыр", "bob"), "not_in_game");
		expectEvent(await send(sm, "!serve", "bob"), "not_in_game");
	});

	it("counts commands and expected failures in runtime metrics", async () => {
		const sm = setup();
		await send(sm, "!put сыр", "bob");
		expect(sm.getMetrics()).toMatchObject({ commands: 1, failures: 1 });
	});

	it("не скрывает defect: ошибка команды не превращается в GameEvent", async () => {
		const sm = setup();
		vi.spyOn(sm, "serveEffect").mockReturnValue(Effect.die(new Error("boom")));
		const sink = new ListSink();
		const exit = Effect.runSyncExit(
			processMessage("!serve", "alice", sm, sink),
		);

		expect(exit._tag).toBe("Failure");
		expect(sink.events).toEqual([]);
	});

	it("не-команда игнорируется: sink нетронут", async () => {
		const sm = setup();
		expect((await send(sm, "привет всем", "bob")).events).toEqual([]);
		expect((await send(sm, "", "bob")).events).toEqual([]);
		expect((await send(sm, "!join", "bob")).events).toEqual([]);
	});

	it("таймаут заказа — XP в минус, авто-выдачи нет", async () => {
		const sm = setup();
		const alice = "alice";
		warmup(sm);
		const order = takeOrder(sm, alice, 0);

		vi.advanceTimersByTime(order.timeLimit + 1);
		expect(order.status).toBe(ORDER_STATUS.EXPIRED);
		expect(sm.getXp(alice)).toBeLessThan(0);
		expect(sm.getOrder(alice)).toBe(order);
		expectEvent(await send(sm, "!put сыр", alice), "no_active_order");
		expectEvent(await send(sm, "!serve", alice), "no_active_order");
		expectEvent(await send(sm, "!bin", alice), "no_active_order");
	});
});

it("после serve новый заказ виден в !заказ и на execution-мониторе", async () => {
	const orders = [fixedBurgerOrder(), fixedColaOrder(), fixedColaOrder()];
	const sm = setup(() => orders.shift()!);
	const alice = "alice";
	warmup(sm);

	expectEvent(await send(sm, "!взять 1", alice), "order_taken");
	for (const id of BURGER_IDS) {
		await runMessage(`!put ${id}`, alice, sm, new ListSink());
	}
	expectEvent(await send(sm, "!serve", alice), "order_served");
	expectEvent(await send(sm, "!put сыр", alice), "no_active_order");
	expectEvent(await send(sm, "!serve", alice), "no_active_order");
	expectEvent(await send(sm, "!bin", alice), "no_active_order");
	expectEvent(await send(sm, "!заказ", alice), "no_active_order");
	expectEvent(await send(sm, "!next", alice), "no_active_order");

	expectEvent(await send(sm, "!взять 2", alice), "order_taken");

	const activeOrder = sm.getActiveOrder(alice);
	expect(activeOrder?.items.map((entry) => entry.item.id)).toEqual([cola.id]);
	expectEvent(await send(sm, "!заказ", alice), "menu_state");

	const execution = projectSnapshot(sm.getSnapshot()).execution;
	expect(execution).toHaveLength(1);
	expect(execution[0].id).toBe(activeOrder?.id);
	expect(execution[0].dishes).toEqual([{ name: cola.name, done: false }]);
});

describe("беседа: !взять", () => {
	it("берёт заказ из слота и показывает его состояние", async () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);

		const event = expectEvent(await send(sm, "!взять 1"), "order_taken");
		expect(event.type === "order_taken" && event.slot).toBe(1);
		expect(
			event.type === "order_taken" &&
				event.order.items.map((entry) => entry.item.id),
		).toEqual([burger.id, cola.id]);
	});

	it("!взять сохраняет timeout после завершения Effect", async () => {
		const sm = setup();
		warmup(sm);
		const event = expectEvent(await send(sm, "!взять 1"), "order_taken");
		if (event.type !== "order_taken") throw new Error("Expected order_taken");

		vi.advanceTimersByTime(event.order.timeLimit + 1);
		expect(sm.getOrder("alice")?.status).toBe(ORDER_STATUS.EXPIRED);
	});

	it("!взять без номера — slot_required", async () => {
		const sm = setup();
		expectEvent(await send(sm, "!взять"), "slot_required");
	});

	it("!взять abc — slot_required", async () => {
		const sm = setup();
		expectEvent(await send(sm, "!взять abc"), "slot_required");
	});

	it("!взять на пустой слот — empty_slot", async () => {
		const sm = setup();
		const event = expectEvent(await send(sm, "!взять 3"), "empty_slot");
		expect(event.type === "empty_slot" && event.slot).toBe(3);
	});

	it("алиас !take работает", async () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		warmup(sm);
		const event = expectEvent(await send(sm, "!take 2"), "order_taken");
		expect(event.type === "order_taken" && event.slot).toBe(2);
	});
});

describe("беседа: полный цикл с !next (два блюда)", () => {
	it("!взять → бургер → !next → кола → !serve → снова свободен", async () => {
		const sm = setup(fixedBurgerColaOrder);
		const alice = "alice";
		warmup(sm);

		expectEvent(await send(sm, "!взять 1"), "order_taken");
		for (const id of BURGER_IDS) {
			await runMessage(`!put ${id}`, alice, sm, new ListSink());
		}

		const sealed = expectEvent(await send(sm, "!next"), "dish_sealed");
		expect(sealed.type === "dish_sealed" && sealed.sealedLayers).toEqual(
			BURGER_IDS,
		);
		expect(sealed.type === "dish_sealed" && sealed.nextItemIndex).toBe(1);
		expect(sm.getTraySnapshot(alice)?.layers).toEqual([]);

		await runMessage("!put кола", alice, sm, new ListSink());
		const served = expectEvent(await send(sm, "!serve"), "order_served");
		expect(sm.getXp(alice)).toBe(
			served.type === "order_served" ? served.assessment.xpDelta : undefined,
		);

		warmup(sm);
		warmup(sm);
		expectEvent(await send(sm, "!взять 2"), "order_taken");
	});

	it("!next без заказа — not_in_game", async () => {
		const sm = setup();
		expectEvent(await send(sm, "!next", "bob"), "not_in_game");
	});

	it("!next на последнем блюде — last_item", async () => {
		const sm = setup();
		warmup(sm);
		takeOrder(sm, "alice", 0);
		await runMessage("!put сыр", "alice", sm, new ListSink());
		expectEvent(await send(sm, "!next"), "last_item");
	});

	it("!next на пустом подносе — tray_empty", async () => {
		const sm = setup(fixedBurgerColaOrder);
		warmup(sm);
		takeOrder(sm, "alice", 0);
		const event = expectEvent(await send(sm, "!next"), "tray_empty");
		expect(event.type === "tray_empty" && event.operation).toBe("next");
	});
});

describe("беседа: !рецепт", () => {
	it("показывает рецепт и запоминает его в RecipeBook", async () => {
		const sm = setup();
		const event = expectEvent(await send(sm, "!рецепт бургер"), "recipe_shown");
		expect(event.type === "recipe_shown" && event.item.id).toBe(burger.id);
		expect(sm.recipeBook.getCurrent()?.id).toBe(burger.id);
	});

	it("!рецепт без аргумента — recipe_arg_required", async () => {
		const sm = setup();
		expectEvent(await send(sm, "!рецепт"), "recipe_arg_required");
	});

	it("неизвестное блюдо — recipe_unknown", async () => {
		const sm = setup();
		const event = expectEvent(
			await send(sm, "!рецепт абракадабра"),
			"recipe_unknown",
		);
		expect(event.type === "recipe_unknown" && event.token).toBe("абракадабра");
	});
});

describe("беседа: алиасы !заказ/!order", () => {
	it("работают как !menu", async () => {
		const sm = setup();
		warmup(sm);
		takeOrder(sm, "alice", 0);
		expectEvent(await send(sm, "!заказ"), "menu_state");
		expectEvent(await send(sm, "!order"), "menu_state");
	});
});
