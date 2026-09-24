import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { SessionManager } from "./session-manager";

function setup(item?: IMenuItem) {
	const port = new RecordingPort();
	const sm = new SessionManager(
		item
			? () => makeOrder({ id: `order-${item.id}`, items: [item] })
			: undefined,
	);
	sm.attachPort(port);
	port.attach(sm);
	sm.incomingOrders.start();
	return { port, sm };
}

/** Прогрев спавна + взятие заказа из слота. */
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

describe("SessionManager: takeOrder", () => {
	it("берёт заказ из слота: сессия лениво создана, персонаж заспавнен", () => {
		const { port, sm } = setup();
		const order = takeOrder(sm, "alice");

		expect(order.status).toBe(ORDER_STATUS.PENDING);
		expect(sm.hasSession("alice")).toBe(true);
		expect(sm.getXp("alice")).toBe(0);
		expect(port.startOrders).toEqual([order]);
	});

	it("busy при активном заказе: второй take не спавнит персонажа", () => {
		const { port, sm } = setup();
		takeOrder(sm, "alice");

		expect(sm.takeOrder("alice", 1)).toEqual({ ok: false, reason: "busy" });
		expect(port.startOrders).toHaveLength(1);
	});

	it("empty_slot на пустой слот — сессия не создаётся", () => {
		const { sm } = setup();

		expect(sm.takeOrder("alice", 0)).toEqual({
			ok: false,
			reason: "empty_slot",
		});
		expect(sm.hasSession("alice")).toBe(false);
	});

	it("невалидный индекс — empty_slot", () => {
		const { sm } = setup();
		vi.advanceTimersByTime(ORDER_CONFIG.SPAWN_INTERVAL_MS);

		expect(sm.takeOrder("alice", -1)).toEqual({
			ok: false,
			reason: "empty_slot",
		});
		expect(sm.takeOrder("alice", 3)).toEqual({
			ok: false,
			reason: "empty_slot",
		});
	});
});

describe("SessionManager: serve", () => {
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

	it("заказ закрыт один раз: дубль события не начисляет XP повторно", () => {
		const { port, sm } = setup(burger);
		takeOrder(sm, "alice");
		port.trayLayers = BURGER_IDS;

		const e = serveEvent("alice", 1000, BURGER_IDS, "order-burger");
		sm.onActionCompleted(e);
		const result = sm.getLastResult("alice");
		const xpAfterFirstEvent = sm.getXp("alice");

		sm.onActionCompleted(e);

		expect(result).not.toBeNull();
		expect(sm.getXp("alice")).toBe(xpAfterFirstEvent);
		expect(sm.getLastResult("alice")).toBe(result);
		expect(port.startOrders).toHaveLength(1);
	});

	it("serve начисляет XP и закрывает заказ; новый игрок берёт сам", () => {
		const { port, sm } = setup(cola);
		const first = takeOrder(sm, "alice");
		port.trayLayers = [cola.id];

		const ack = sm.serve("alice");
		const result = sm.getLastResult("alice");
		expect(ack).toEqual({ ok: true });
		expect(result).not.toBeNull();
		expect(sm.getXp("alice")).toBe(result?.xpDelta);
		expect(sm.getOrder("alice")).toBe(first);
		expect(first.status).toBe(ORDER_STATUS.COMPLETED);

		const second = takeOrder(sm, "alice");
		expect(second).not.toBe(first);
		expect(port.startOrders).toEqual([first, second]);
	});

	it("serve пустого подноса — штраф", () => {
		const { port, sm } = setup(cola);
		takeOrder(sm, "alice");
		port.trayLayers = [];

		sm.serve("alice");
		const result = sm.getLastResult("alice");
		expect(result).not.toBeNull();
		expect(result?.xpDelta).toBeLessThan(0);
		expect(sm.getXp("alice")).toBe(result?.xpDelta);
	});

	it("после serve активного заказа у исполнителя нет", () => {
		const { port, sm } = setup(cola);
		const order = takeOrder(sm, "alice");
		port.trayLayers = [cola.id];

		sm.serve("alice");

		expect(order.status).toBe(ORDER_STATUS.COMPLETED);
		expect(sm.getOrder("alice")).toBe(order);
		expect(sm.getActiveOrder("alice")).toBeUndefined();
	});
});

describe("SessionManager: таймаут", () => {
	it("onTimeout снимает XP, идемпотентен по ссылке на заказ", () => {
		const { port, sm } = setup();
		const order = takeOrder(sm, "alice");

		sm.onTimeout("alice", order);
		const xpAfterTimeout = sm.getXp("alice");

		expect(order.status).toBe(ORDER_STATUS.EXPIRED);
		expect(xpAfterTimeout).toBeLessThan(0);
		expect(port.cancels).toEqual(["timeout"]);
		expect(port.tasks).toHaveLength(0);
		expect(sm.getOrder("alice")).toBe(order); // авто-выдачи нет

		// повторный вызов со старым заказом — игнор
		sm.onTimeout("alice", order);
		expect(sm.getXp("alice")).toBe(xpAfterTimeout);
		expect(port.cancels).toHaveLength(1);
	});

	it("таймер тикает сам: после timeLimit заказ истекает", () => {
		const { port, sm } = setup();
		const orderA = takeOrder(sm, "alice");

		vi.advanceTimersByTime(orderA.timeLimit + 1);
		expect(orderA.status).toBe(ORDER_STATUS.EXPIRED);
		expect(sm.getXp("alice")).toBeLessThan(0);
		expect(port.cancels).toEqual(["timeout"]);
		expect(sm.getOrder("alice")).toBe(orderA);

		// после таймаута игрок может взять следующий заказ
		const orderB = takeOrder(sm, "alice");
		expect(orderB).not.toBe(orderA);
		expect(port.startOrders).toEqual([orderA, orderB]);
		expect(port.cancels).toEqual(["timeout"]);
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
		port.attach(sm);
		sm.incomingOrders.start();
		return { port, sm };
	}

	it("запечатывает блюдо: снапшот в sealed, поднос очищен, индекс растёт", () => {
		const { port, sm } = setupTwoDish();
		takeOrder(sm, "alice");

		port.trayLayers = BURGER_IDS; // собран бургер
		expect(sm.nextDish("alice")).toEqual({ ok: true });
		expect(port.getTraySnapshot("alice")?.layers).toEqual([]); // поднос очищен
		expect(sm.getSealedDishes("alice")).toHaveLength(1);
		expect(sm.getSealedDishes("alice")[0].layers).toEqual(BURGER_IDS);

		// второе блюдо — последнее: last_item
		expect(sm.nextDish("alice")).toEqual({ ok: false, reason: "last_item" });
	});

	it("tray_empty: нечего запечатывать на пустом подносе", () => {
		const { sm } = setupTwoDish();
		takeOrder(sm, "alice");
		expect(sm.nextDish("alice")).toEqual({ ok: false, reason: "tray_empty" });
	});

	it("no_order: нет сессии или заказ уже закрыт", () => {
		const { sm } = setup();
		expect(sm.nextDish("alice")).toEqual({ ok: false, reason: "no_order" });

		const { sm: sm2 } = setupTwoDish();
		takeOrder(sm2, "alice");
		sm2.serve("alice"); // пустой поднос — штраф, заказ COMPLETED
		expect(sm2.nextDish("alice")).toEqual({ ok: false, reason: "no_order" });
	});

	it("serve после next: пер-dish оценка, бургер+кола = perfect", () => {
		const { port, sm } = setupTwoDish();
		takeOrder(sm, "alice");

		port.trayLayers = BURGER_IDS;
		expect(sm.nextDish("alice")).toEqual({ ok: true });
		port.trayLayers = [cola.id];

		const ack = sm.serve("alice");
		const result = sm.getLastResult("alice");
		expect(ack).toEqual({ ok: true });
		expect(result).not.toBeNull();
		expect(sm.getXp("alice")).toBe(result?.xpDelta);
	});
});
