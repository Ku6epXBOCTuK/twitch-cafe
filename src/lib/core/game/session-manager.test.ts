import { Duration, Effect, Layer, Queue, Result, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { ORDER_CONFIG } from "../config";
import type { IMenuItem } from "../types/menu_item";
import type { IOrder } from "../types/order";
import { ORDER_STATUS } from "../types/order";
import {
	burger,
	BURGER_IDS,
	cola,
	makeOrder,
	RecordingPort,
} from "#lib/test-support";
import { DEFAULT_GAME_CONFIG, GameConfig } from "./game-config";
import { SessionManager } from "./session-manager";

function setup(item?: IMenuItem) {
	const port = new RecordingPort();
	const sessionManager = new SessionManager(
		item
			? () => makeOrder({ id: `order-${item.id}`, items: [item] })
			: undefined,
	);
	sessionManager.attachPort(port);
	return { port, sm: sessionManager };
}

async function run<A, E>(
	sm: SessionManager,
	program: Effect.Effect<A, E, TestClock.TestClock | Scope.Scope>,
): Promise<A> {
	return Effect.runPromise(
		Effect.scoped(
			Effect.provide(
				program.pipe(Effect.ensuring(sm.stopEffect())),
				Layer.mergeAll(
					TestClock.layer(),
					Layer.succeed(GameConfig, DEFAULT_GAME_CONFIG),
				),
			),
		),
	);
}

function serveEvent(
	username: string,
	frozenAt: number,
	layers: string[],
	orderId = "test-order",
) {
	return {
		type: "ACTION_COMPLETED" as const,
		username,
		orderId,
		sequence: 1,
		finishedAt: frozenAt,
		action: { kind: "serve" as const, targetId: 0, startedAt: 0 },
		tray: { username, layers, frozenAt },
	};
}

describe("SessionManager: takeOrder", () => {
	it("берёт заказ из слота: сессия лениво создана, персонаж заспавнен", async () => {
		const { port, sm } = setup();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				const order = yield* sm.takeOrderEffect("alice", 0);
				expect(order.status).toBe(ORDER_STATUS.PENDING);
				expect(sm.hasSession("alice")).toBe(true);
				expect(sm.getXp("alice")).toBe(0);
				expect(port.startOrders).toEqual([order]);
			}),
		);
	});

	it("busy при активном заказе: второй take не спавнит персонажа", async () => {
		const { port, sm } = setup();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				const result = yield* Effect.result(sm.takeOrderEffect("alice", 1));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure._tag).toBe("Busy");
				}
				expect(port.startOrders).toHaveLength(1);
			}),
		);
	});

	it("empty_slot на пустом слот — сессия не создаётся", async () => {
		const { sm } = setup();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				const result = yield* Effect.result(sm.takeOrderEffect("alice", 0));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure._tag).toBe("EmptySlot");
				}
				expect(sm.hasSession("alice")).toBe(false);
			}),
		);
	});

	it("невалидный индекс — empty_slot", async () => {
		const { sm } = setup();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				for (const slot of [-1, 3]) {
					const result = yield* Effect.result(
						sm.takeOrderEffect("alice", slot),
					);
					expect(Result.isFailure(result)).toBe(true);
					if (Result.isFailure(result)) {
						expect(result.failure._tag).toBe("EmptySlot");
					}
				}
			}),
		);
	});
});

describe("SessionManager: serve", () => {
	it("заказ закрыт один раз: дубль события не начисляет XP повторно", async () => {
		const { port, sm } = setup(burger);
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				port.trayLayers = BURGER_IDS;
				const event = serveEvent("alice", 1000, BURGER_IDS, "order-burger");
				yield* Queue.offer(port.eventQueue, event);
				yield* TestClock.adjust(Duration.millis(1));
				const result = sm.getLastResult("alice");
				const xpAfterFirstEvent = sm.getXp("alice");
				yield* Queue.offer(port.eventQueue, event);
				yield* TestClock.adjust(Duration.millis(1));
				expect(result).not.toBeNull();
				expect(sm.getXp("alice")).toBe(xpAfterFirstEvent);
				expect(sm.getLastResult("alice")).toBe(result);
				expect(port.startOrders).toHaveLength(1);
			}),
		);
	});

	it("serve начисляет XP и закрывает заказ; новый игрок берёт сам", async () => {
		const { port, sm } = setup(cola);
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				const first = yield* sm.takeOrderEffect("alice", 0);
				port.trayLayers = [cola.id];
				yield* sm.serveEffect("alice");
				const result = sm.getLastResult("alice");
				expect(result).not.toBeNull();
				expect(sm.getXp("alice")).toBe(result?.xpDelta);
				expect(sm.getOrder("alice")).toBe(first);
				expect(first.status).toBe(ORDER_STATUS.COMPLETED);

				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				const second = yield* sm.takeOrderEffect("alice", 0);
				expect(second).not.toBe(first);
				expect(port.startOrders).toEqual([first, second]);
			}),
		);
	});

	it("serve пустого подноса — штраф", async () => {
		const { port, sm } = setup(cola);
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				port.trayLayers = [];
				yield* sm.serveEffect("alice");
				const result = sm.getLastResult("alice");
				expect(result).not.toBeNull();
				expect(result?.xpDelta).toBeLessThan(0);
				expect(sm.getXp("alice")).toBe(result?.xpDelta);
			}),
		);
	});

	it("после serve активного заказа у исполнителя нет", async () => {
		const { port, sm } = setup(cola);
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				const order = yield* sm.takeOrderEffect("alice", 0);
				port.trayLayers = [cola.id];
				yield* sm.serveEffect("alice");
				expect(order.status).toBe(ORDER_STATUS.COMPLETED);
				expect(sm.getOrder("alice")).toBe(order);
				expect(sm.getActiveOrder("alice")).toBeUndefined();
			}),
		);
	});
});

describe("SessionManager: таймаут", () => {
	it("таймер тикает сам: после timeLimit заказ истекает", async () => {
		const { port, sm } = setup();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				const order = yield* sm.takeOrderEffect("alice", 0);
				yield* TestClock.adjust(Duration.millis(order.timeLimit + 1));
				expect(order.status).toBe(ORDER_STATUS.EXPIRED);
				expect(sm.getXp("alice")).toBeLessThan(0);
				expect(port.cancels).toEqual(["timeout"]);
				expect(sm.getOrder("alice")).toBe(order);
			}),
		);
	});

	it("после таймаута игрок может взять следующий заказ", async () => {
		const { port, sm } = setup();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				const orderA = yield* sm.takeOrderEffect("alice", 0);
				yield* TestClock.adjust(Duration.millis(orderA.timeLimit + 1));
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				const orderB = yield* sm.takeOrderEffect("alice", 0);
				expect(orderB).not.toBe(orderA);
				expect(port.startOrders).toEqual([orderA, orderB]);
				expect(port.cancels).toEqual(["timeout"]);
			}),
		);
	});
});

describe("SessionManager: nextDish", () => {
	function twoDishOrder(): IOrder {
		return makeOrder({ id: "order-two", items: [burger, cola] });
	}

	function setupTwoDish() {
		const port = new RecordingPort();
		const sm = new SessionManager(twoDishOrder);
		sm.attachPort(port);
		return { port, sm };
	}

	it("запечатывает блюдо: снапшот в sealed, поднос очищен, индекс растёт", async () => {
		const { port, sm } = setupTwoDish();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				port.trayLayers = BURGER_IDS;
				yield* sm.nextDishEffect("alice");
				expect(port.getTraySnapshot("alice")?.layers).toEqual([]);
				expect(sm.getSealedDishes("alice")).toHaveLength(1);
				expect(sm.getSealedDishes("alice")[0].layers).toEqual(BURGER_IDS);
				const result = yield* Effect.result(sm.nextDishEffect("alice"));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure._tag).toBe("LastItem");
				}
			}),
		);
	});

	it("tray_empty: нечего запечатывать на пустом подносе", async () => {
		const { sm } = setupTwoDish();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				const result = yield* Effect.result(sm.nextDishEffect("alice"));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure._tag).toBe("TrayEmpty");
				}
			}),
		);
	});

	it("no_order: нет сессии или заказ уже закрыт", async () => {
		const { sm } = setup();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				const result = yield* Effect.result(sm.nextDishEffect("alice"));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure._tag).toBe("NoOrder");
				}
			}),
		);

		const { sm: sm2 } = setupTwoDish();
		await run(
			sm2,
			Effect.gen(function* () {
				yield* sm2.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm2.takeOrderEffect("alice", 0);
				yield* sm2.serveEffect("alice");
				const result = yield* Effect.result(sm2.nextDishEffect("alice"));
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(result.failure._tag).toBe("NoOrder");
				}
			}),
		);
	});

	it("serve после next: предиш оценка, бургер+кола = perfect", async () => {
		const { port, sm } = setupTwoDish();
		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				port.trayLayers = BURGER_IDS;
				yield* sm.nextDishEffect("alice");
				port.trayLayers = [cola.id];
				yield* sm.serveEffect("alice");
				const result = sm.getLastResult("alice");
				expect(result).not.toBeNull();
				expect(sm.getXp("alice")).toBe(result?.xpDelta);
			}),
		);
	});
});
