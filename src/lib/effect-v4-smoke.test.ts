import { describe, expect, it } from "vitest";
import { Effect, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { runWithTestClock } from "./test-support/effect";

const SmokeInput = Schema.Struct({ value: Schema.Number });

const smokeProgram = Effect.scoped(
	Effect.gen(function* () {
		const input = yield* Schema.decodeEffect(SmokeInput)({ value: 41 });
		const fiber = yield* Effect.forkScoped(
			Effect.gen(function* () {
				yield* Effect.sleep("1 second");
				return input.value + 1;
			}),
		);
		yield* TestClock.adjust("1 second");
		return yield* Fiber.join(fiber);
	}),
);

describe("Effect v4 compatibility", () => {
	it("supports gen, schema, scope, layer and test clock", async () => {
		const result = await runWithTestClock(smokeProgram);

		expect(result).toBe(42);
	});
});
