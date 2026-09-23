import { Effect } from "effect";
import { TestClock } from "effect/testing";

export function runWithTestClock<A, E>(
	effect: Effect.Effect<A, E, TestClock.TestClock>,
): Promise<A> {
	return Effect.runPromise(Effect.provide(effect, TestClock.layer()));
}
