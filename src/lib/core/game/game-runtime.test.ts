import { Clock, Effect, Layer, Random } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../config";
import { GameConfig, makeGameRuntime } from "./game-runtime";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("GameRuntime", () => {
	it("starts and shuts down idempotently", () => {
		const runtime = makeGameRuntime();

		expect(runtime.isRunning()).toBe(false);
		Effect.runSync(runtime.start);
		Effect.runSync(runtime.start);
		expect(runtime.isRunning()).toBe(true);

		Effect.runSync(runtime.shutdown);
		Effect.runSync(runtime.shutdown);
		expect(runtime.isRunning()).toBe(false);
	});

	it("exposes the current snapshot through the runtime service", () => {
		const runtime = makeGameRuntime();
		expect(Effect.runSync(runtime.getSnapshot)).toEqual(
			runtime.core.sessionManager.getSnapshot(),
		);
	});

	it("composes config, clock and random services", async () => {
		const config = { ...ORDER_CONFIG, SLOT_COUNT: 1 } as const;
		const runtime = makeGameRuntime(config);
		const probe = Effect.gen(function* () {
			const resolvedConfig = yield* GameConfig;
			const now = yield* Clock.currentTimeMillis;
			const random = yield* Random.next;
			return {
				slotCount: resolvedConfig.SLOT_COUNT,
				now,
				random,
			};
		});

		const result = await Effect.runPromise(
			Effect.scoped(
				Effect.provide(probe, Layer.mergeAll(runtime.layer, TestClock.layer())),
			),
		);

		expect(result.slotCount).toBe(1);
		expect(result.now).toBe(0);
		expect(result.random).toBeGreaterThanOrEqual(0);
		expect(result.random).toBeLessThan(1);
		expect(runtime.layer).toBeDefined();
	});
});
