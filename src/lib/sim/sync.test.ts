import { Duration, Effect, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import { INGREDIENTS } from "../core/data/menu";
import { SessionManager } from "../core/game/session-manager";
import { DEFAULT_GAME_CONFIG, GameConfig } from "../core/game/game-config";
import { burger, makeOrder } from "#lib/test-support";
import { connectMiniplexSim } from "./sync";

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

describe("MiniplexSim integration", () => {
	it("проходит put через SessionManager после ручного tick", async () => {
		const sm = new SessionManager(() =>
			makeOrder({ id: "miniplex-order", items: [burger] }),
		);
		const sim = connectMiniplexSim(sm);

		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				yield* sm.putIngredientEffect("alice", INGREDIENTS.patty.id);
				yield* Effect.yieldNow;
				yield* sim.tick(1000);
				yield* Effect.yieldNow;

				expect(sim.getTraySnapshot("alice")?.layers).toEqual([
					INGREDIENTS.patty.id,
				]);
			}),
		);
	});
});
