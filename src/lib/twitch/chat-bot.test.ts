import type { ChatClient } from "@twurple/chat";
import { Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import { burger, makeOrder, RecordingPort } from "#lib/test-support";
import { DEFAULT_GAME_CONFIG, GameConfig } from "../core/game/game-config";
import { SessionManager } from "../core/game/session-manager";
import { subscribeToTimeoutNotifications } from "./chat-bot";

describe("timeout notifications", () => {
	it("sends one notification to the configured channel", async () => {
		const port = new RecordingPort();
		const sessionManager = new SessionManager(() =>
			makeOrder({ id: "timeout-order", items: [burger] }),
		);
		sessionManager.attachPort(port);
		const say = vi.fn().mockResolvedValue(undefined);
		const unsubscribe = subscribeToTimeoutNotifications(
			sessionManager,
			{ say } as unknown as Pick<ChatClient, "say">,
			"alerts",
		);

		await Effect.runPromise(
			Effect.scoped(
				Effect.provide(
					Effect.gen(function* () {
						yield* sessionManager.startEffect();
						yield* TestClock.adjust(
							Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
						);
						const order = yield* sessionManager.takeOrderEffect("alice", 0);
						yield* TestClock.adjust(Duration.millis(order.timeLimit + 1));
					}).pipe(Effect.ensuring(sessionManager.stopEffect())),
					Layer.mergeAll(
						TestClock.layer(),
						Layer.succeed(GameConfig, DEFAULT_GAME_CONFIG),
					),
				),
			),
		);
		unsubscribe();

		expect(say).toHaveBeenCalledTimes(1);
		expect(say.mock.calls[0]?.[0]).toBe("alerts");
		expect(say.mock.calls[0]?.[1]).toContain("alice");
		expect(say.mock.calls[0]?.[1]).toContain("заказ истёк");
	});
});
