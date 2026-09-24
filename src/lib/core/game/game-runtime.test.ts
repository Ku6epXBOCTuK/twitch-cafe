import { Clock, Effect, Layer, Random, Stream } from "effect";
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

	it("closes event subscriptions during shutdown", async () => {
		const runtime = makeGameRuntime();
		Effect.runSync(runtime.start);
		const reader = Stream.toReadableStream(runtime.events).getReader();
		const first = await reader.read();
		expect(first.done).toBe(false);

		Effect.runSync(runtime.shutdown);
		const next = await reader.read();
		expect(next.done).toBe(true);
	});

	it("reports bounded resource metrics and clears timers on shutdown", () => {
		const runtime = makeGameRuntime();
		runtime.core.sessionManager.recordCommand();
		runtime.core.sessionManager.recordFailure();

		Effect.runSync(runtime.start);
		expect(Effect.runSync(runtime.getMetrics)).toMatchObject({
			commands: 1,
			failures: 1,
			queueDepth: 0,
			activeSessions: 0,
			timerCount: 1,
		});

		Effect.runSync(runtime.shutdown);
		expect(Effect.runSync(runtime.getMetrics)).toMatchObject({
			timerCount: 0,
		});
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
