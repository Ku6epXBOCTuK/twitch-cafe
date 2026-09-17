import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../config";
import { ORDER_STATUS } from "../types/order";
import { IncomingOrders } from "./incoming-orders";

const { SPAWN_INTERVAL_MS, SLOT_LIFETIME_MS, SLOT_COUNT } = ORDER_CONFIG;

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("IncomingOrders: спавн", () => {
	it("до первого тика слоты пусты", () => {
		const board = new IncomingOrders();
		board.start();

		expect(board.getSlots().every((slot) => slot === null)).toBe(true);
	});

	it("наполняет слоты по тикам до SLOT_COUNT и не больше", () => {
		const board = new IncomingOrders();
		board.start();

		vi.advanceTimersByTime(SPAWN_INTERVAL_MS);
		expect(board.getSlots().filter(Boolean)).toHaveLength(1);

		vi.advanceTimersByTime(SPAWN_INTERVAL_MS * 2);
		expect(board.getSlots().filter(Boolean)).toHaveLength(SLOT_COUNT);

		vi.advanceTimersByTime(SPAWN_INTERVAL_MS * 5);
		expect(board.getSlots().filter(Boolean)).toHaveLength(SLOT_COUNT);
	});

	it("спавн при полных слотах пропускается, освобождённый слот заполняется следующим тиком", () => {
		const board = new IncomingOrders();
		board.start();
		vi.advanceTimersByTime(SPAWN_INTERVAL_MS * SLOT_COUNT);

		const taken = board.take(0);
		expect(taken.ok).toBe(true);

		vi.advanceTimersByTime(SPAWN_INTERVAL_MS);
		const slots = board.getSlots();
		expect(slots[0]).not.toBeNull();
		expect(slots.filter(Boolean)).toHaveLength(SLOT_COUNT);
	});
});

describe("IncomingOrders: сгорание", () => {
	it("невзятый заказ сгорает по LIFETIME и получает EXPIRED", () => {
		const board = new IncomingOrders();
		board.start();
		vi.advanceTimersByTime(SPAWN_INTERVAL_MS);

		const order = board.getSlots()[0]!;
		vi.advanceTimersByTime(SLOT_LIFETIME_MS);

		expect(order.status).toBe(ORDER_STATUS.EXPIRED);
		expect(board.getSlots()).not.toContain(order);
	});

	it("заказы, заспавненные позже, сгорают по своему сроку", () => {
		const board = new IncomingOrders();
		board.start();
		vi.advanceTimersByTime(SPAWN_INTERVAL_MS * 2);

		const first = board.getSlots()[0]!;
		const second = board.getSlots()[1]!;

		vi.advanceTimersByTime(SLOT_LIFETIME_MS - SPAWN_INTERVAL_MS);
		expect(first.status).toBe(ORDER_STATUS.EXPIRED);
		expect(board.getSlots()).not.toContain(first);
		expect(board.getSlots()).toContain(second);

		vi.advanceTimersByTime(SPAWN_INTERVAL_MS);
		expect(second.status).toBe(ORDER_STATUS.EXPIRED);
		expect(board.getSlots()).not.toContain(second);
	});
});

describe("IncomingOrders: взятие", () => {
	it("take отдаёт заказ и освобождает слот; сгорание снято", () => {
		const board = new IncomingOrders();
		board.start();
		vi.advanceTimersByTime(SPAWN_INTERVAL_MS);

		const expected = board.getSlots()[0]!;
		const result = board.take(0);
		expect(result).toEqual({ ok: true, order: expected });
		expect(board.getSlots()[0]).toBeNull();

		vi.advanceTimersByTime(SLOT_LIFETIME_MS * 2);
		expect(expected.status).toBe(ORDER_STATUS.PENDING);
	});

	it("take пустого или невалидного слота — empty_slot", () => {
		const board = new IncomingOrders();
		board.start();

		expect(board.take(0)).toEqual({ ok: false, reason: "empty_slot" });
		expect(board.take(-1)).toEqual({ ok: false, reason: "empty_slot" });
		expect(board.take(SLOT_COUNT)).toEqual({ ok: false, reason: "empty_slot" });
	});

	it("stop гасит спавн и сгорание", () => {
		const board = new IncomingOrders();
		board.start();
		vi.advanceTimersByTime(SPAWN_INTERVAL_MS);
		board.stop();

		vi.advanceTimersByTime(SPAWN_INTERVAL_MS * 10);
		const slots = board.getSlots();
		expect(slots.filter(Boolean)).toHaveLength(1);
		expect(slots[0]!.status).toBe(ORDER_STATUS.PENDING);
	});
});
