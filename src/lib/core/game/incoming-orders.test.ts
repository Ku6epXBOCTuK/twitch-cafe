import { Duration, Effect, Layer, Result, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { ORDER_CONFIG } from "../config";
import { ORDER_STATUS } from "../types/order";
import { DEFAULT_GAME_CONFIG, GameConfig } from "./game-config";
import { IncomingOrders } from "./incoming-orders";

const { SPAWN_INTERVAL_MS, SLOT_LIFETIME_MS, SLOT_COUNT } = ORDER_CONFIG;

async function runWithClock<A>(
	board: IncomingOrders,
	program: Effect.Effect<A, never, TestClock.TestClock | Scope.Scope>,
	config: GameConfig = DEFAULT_GAME_CONFIG,
): Promise<A> {
	return Effect.runPromise(
		Effect.scoped(
			Effect.provide(
				program,
				Layer.mergeAll(TestClock.layer(), Layer.succeed(GameConfig, config)),
			),
		),
	);
}

describe("IncomingOrders", () => {
	it("до первого тика слоты пусты", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				expect(board.getSlots().every((slot) => slot === null)).toBe(true);
			}),
		);
	});

	it("наполняет все свободные слоты одной волной", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS));
				expect(board.getSlots().filter(Boolean)).toHaveLength(SLOT_COUNT);

				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS * 2));
				expect(board.getSlots().filter(Boolean)).toHaveLength(SLOT_COUNT);
			}),
		);
	});

	it("повторный start не создаёт второй spawn loop", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				yield* board.startEffect();
				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS));
				expect(board.getSlots().filter(Boolean)).toHaveLength(SLOT_COUNT);
			}),
		);
	});

	it("использует значения GameConfig для слотов и spawn interval", async () => {
		const config = {
			...ORDER_CONFIG,
			SLOT_COUNT: 1,
			SPAWN_INTERVAL_MS: 10,
			SLOT_LIFETIME_MS: 20,
		} as const;
		const board = new IncomingOrders(undefined, config);
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				yield* TestClock.adjust(Duration.millis(9));
				expect(board.getSlots().filter(Boolean)).toHaveLength(0);
				yield* TestClock.adjust(Duration.millis(1));
				expect(board.getSlots().filter(Boolean)).toHaveLength(1);
			}),
			config,
		);
	});

	it("невзятый заказ сгорает по LIFETIME и получает EXPIRED", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS));
				const order = board.getSlots()[0]!;
				yield* TestClock.adjust(Duration.millis(SLOT_LIFETIME_MS));

				expect(order.status).toBe(ORDER_STATUS.EXPIRED);
				expect(board.getSlots()).not.toContain(order);
			}),
		);
	});

	it("взятие одного слота не отменяет burn остальных", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS));
				const first = board.getSlots()[0]!;
				const second = board.getSlots()[1]!;
				const takenResult = yield* Effect.result(board.takeOrderEffect(0));
				if (Result.isFailure(takenResult)) throw new Error("take failed");
				expect(takenResult.success).toBe(first);
				yield* TestClock.adjust(Duration.millis(SLOT_LIFETIME_MS + 1));
				expect(first.status).toBe(ORDER_STATUS.PENDING);
				expect(second.status).toBe(ORDER_STATUS.EXPIRED);
				expect(board.getSlots()).not.toContain(first);
				expect(board.getSlots()).not.toContain(second);
			}),
		);
	});

	it("take отдаёт заказ, освобождает слот и отменяет burn этого слота", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS));
				const expected = board.getSlots()[0]!;
				const result = yield* Effect.result(board.takeOrderEffect(0));
				if (Result.isFailure(result)) throw new Error("take failed");
				expect(result.success).toBe(expected);
				expect(board.getSlots()[0]).toBeNull();
				yield* TestClock.adjust(Duration.millis(SLOT_LIFETIME_MS * 2));
				expect(expected.status).toBe(ORDER_STATUS.PENDING);
			}),
		);
	});

	it("take пустого или невалидного слота возвращает EmptySlot", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				for (const slot of [0, -1, SLOT_COUNT]) {
					const result = yield* Effect.result(board.takeOrderEffect(slot));
					expect(Result.isFailure(result)).toBe(true);
					if (Result.isFailure(result)) {
						expect(result.failure._tag).toBe("EmptySlot");
						expect(result.failure.slot).toBe(slot);
					}
				}
			}),
		);
	});

	it("stop гасит spawn и burn", async () => {
		const board = new IncomingOrders();
		await runWithClock(
			board,
			Effect.gen(function* () {
				yield* board.startEffect();
				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS));
				const order = board.getSlots()[0]!;
				yield* board.stopEffect();
				yield* TestClock.adjust(Duration.millis(SPAWN_INTERVAL_MS * 10));

				expect(board.isRunning()).toBe(false);
				expect(board.getSlots()).toHaveLength(SLOT_COUNT);
				expect(board.getSlots()[0]).toBe(order);
				expect(order.status).toBe(ORDER_STATUS.PENDING);
			}),
		);
	});
});
