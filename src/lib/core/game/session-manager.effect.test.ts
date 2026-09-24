import { Duration, Effect, Layer, Queue, Result, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { ORDER_CONFIG } from "../config";
import { ORDER_STATUS } from "../types/order";
import { burger, cola, makeOrder, RecordingPort } from "#lib/test-support";
import type { IMenuItem } from "../types/menu_item";
import { ACTION_KIND, type ActionCompletedEvent } from "./sim-dto";
import { SessionManager } from "./session-manager";

const orderTimeLimit = 100;

function setup(orderId: string, items: readonly IMenuItem[] = [burger]) {
	const order = makeOrder({ id: orderId, items, timeLimit: orderTimeLimit });
	const port = new RecordingPort();
	const sessionManager = new SessionManager(() =>
		makeOrder({ id: orderId, items, timeLimit: orderTimeLimit }),
	);
	sessionManager.attachPort(port);
	return { order, port, sessionManager };
}

function serveEvent(
	username: string,
	orderId: string,
	sequence: number,
): ActionCompletedEvent {
	return {
		type: "ACTION_COMPLETED",
		username,
		orderId,
		sequence,
		finishedAt: 1,
		action: { kind: ACTION_KIND.SERVE, targetId: 0, startedAt: 0 },
		tray: { username, layers: [burger.id], frozenAt: 1 },
	};
}

async function run<A, E>(
	program: Effect.Effect<A, E, TestClock.TestClock | Scope.Scope>,
): Promise<A> {
	return Effect.runPromise(
		Effect.scoped(Effect.provide(program, Layer.mergeAll(TestClock.layer()))),
	);
}

describe("SessionManager Effect lifecycle", () => {
	it("returns a typed TaskRefused failure without a SIM character", async () => {
		const sessionManager = new SessionManager();
		const result = await run(
			Effect.gen(function* () {
				return yield* Effect.result(sessionManager.serveEffect("ghost"));
			}),
		);

		expect(result._tag).toBe("Failure");
		if (result._tag === "Failure") {
			expect(result.failure._tag).toBe("TaskRefused");
			if (result.failure._tag === "TaskRefused") {
				expect(result.failure.reason).toBe("no_character");
			}
		}
	});

	it("propagates a closed SIM queue as a typed failure", async () => {
		const { port, sessionManager } = setup("closed-queue");
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				yield* Queue.shutdown(port.eventQueue);
				return yield* Effect.result(sessionManager.serveEffect("alice"));
			}),
		);

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure._tag).toBe("SimQueueClosed");
		}
	});

	it("serve after timeout is ignored and does not change XP", async () => {
		const { order, port, sessionManager } = setup("late-serve");
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				yield* TestClock.adjust(Duration.millis(orderTimeLimit + 1));
				const xpAfterTimeout = sessionManager.getXp("alice");
				yield* Queue.offer(port.eventQueue, serveEvent("alice", order.id, 1));
				yield* TestClock.adjust(Duration.millis(1));
				return {
					orderStatus: sessionManager.getOrder("alice")?.status,
					xpAfterTimeout,
					xpAfterLateServe: sessionManager.getXp("alice"),
					cancels: [...port.cancels],
				};
			}),
		);

		expect(result.orderStatus).toBe(ORDER_STATUS.EXPIRED);
		expect(result.xpAfterLateServe).toBe(result.xpAfterTimeout);
		expect(result.cancels).toEqual(["timeout"]);
	});

	it("serve completes once; duplicate and wrong-order events are ignored", async () => {
		const { order, port, sessionManager } = setup("duplicate-serve");
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				port.trayLayers = [burger.id];
				yield* sessionManager.serveEffect("alice");
				const xpAfterServe = sessionManager.getXp("alice");
				yield* Queue.offer(
					port.eventQueue,
					serveEvent("alice", "wrong-order", 2),
				);
				yield* Queue.offer(port.eventQueue, serveEvent("alice", order.id, 1));
				yield* TestClock.adjust(Duration.millis(1));
				return {
					orderStatus: sessionManager.getOrder("alice")?.status,
					xpAfterServe,
					xpAfterEvents: sessionManager.getXp("alice"),
				};
			}),
		);

		expect(result.orderStatus).toBe(ORDER_STATUS.COMPLETED);
		expect(result.xpAfterEvents).toBe(result.xpAfterServe);
	});

	it("duplicate queue delivery does not apply a terminal transition twice", async () => {
		const { order, port, sessionManager } = setup("queue-duplicate");
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				port.trayLayers = [burger.id];
				yield* sessionManager.serveEffect("alice");
				const xpAfterServe = sessionManager.getXp("alice");
				const event = serveEvent("alice", order.id, 1);
				yield* Queue.offer(port.eventQueue, event);
				yield* Queue.offer(port.eventQueue, event);
				yield* TestClock.adjust(Duration.millis(1));
				return {
					orderStatus: sessionManager.getOrder("alice")?.status,
					xpAfterServe,
					xpAfterDuplicate: sessionManager.getXp("alice"),
				};
			}),
		);

		expect(result.orderStatus).toBe(ORDER_STATUS.COMPLETED);
		expect(result.xpAfterDuplicate).toBe(result.xpAfterServe);
	});

	it("handles a multi-player command soak with bounded resources", async () => {
		const { port, sessionManager } = setup("soak");
		const players = ["alice", "bob", "carol"];
		const metrics = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				for (let round = 0; round < 10; round += 1) {
					yield* TestClock.adjust(
						Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS * 3),
					);
					for (const [index, username] of players.entries()) {
						yield* sessionManager.takeOrderEffect(username, index);
						port.trayLayers = [burger.id];
						yield* sessionManager.serveEffect(username);
					}
				}
				return sessionManager.getMetrics(0);
			}),
		);

		expect(metrics).toMatchObject({
			activeSessions: 3,
			queueDepth: 0,
			timerCount: 1,
		});
	});

	it("timeout after serve does not change XP", async () => {
		const { port, sessionManager } = setup("serve-then-timeout");
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				port.trayLayers = [burger.id];
				yield* sessionManager.serveEffect("alice");
				const xpAfterServe = sessionManager.getXp("alice");
				yield* TestClock.adjust(Duration.millis(orderTimeLimit + 1));
				return {
					orderStatus: sessionManager.getOrder("alice")?.status,
					xpAfterServe,
					xpAfterTimeout: sessionManager.getXp("alice"),
				};
			}),
		);

		expect(result.orderStatus).toBe(ORDER_STATUS.COMPLETED);
		expect(result.xpAfterTimeout).toBe(result.xpAfterServe);
	});

	it("stop cancels timeout and prevents late expiration", async () => {
		const { port, sessionManager } = setup("stop-timeout");
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				const xpBeforeStop = sessionManager.getXp("alice");
				yield* sessionManager.stopEffect();
				yield* TestClock.adjust(Duration.millis(orderTimeLimit + 1));
				return {
					orderStatus: sessionManager.getOrder("alice")?.status,
					xpBeforeStop,
					xpAfterStop: sessionManager.getXp("alice"),
					cancels: [...port.cancels],
				};
			}),
		);

		expect(result.orderStatus).toBe(ORDER_STATUS.PENDING);
		expect(result.xpAfterStop).toBe(result.xpBeforeStop);
		expect(result.cancels).toEqual([]);
	});

	it("despawn during a pending order expires it with leave", async () => {
		const { port, sessionManager } = setup("despawn-order");
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				yield* port.despawn("alice");
				yield* TestClock.adjust(Duration.millis(1));
				return {
					orderStatus: sessionManager.getOrder("alice")?.status,
					cancels: [...port.cancels],
				};
			}),
		);

		expect(result.orderStatus).toBe(ORDER_STATUS.EXPIRED);
		expect(result.cancels).toEqual(["leave"]);
	});

	it("nextDish uses Effect Clock for the sealed snapshot", async () => {
		const { port, sessionManager } = setup("next-clock", [burger, cola]);
		const result = await run(
			Effect.gen(function* () {
				yield* sessionManager.startEffect();
				yield* TestClock.adjust(
					Duration.millis(ORDER_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sessionManager.takeOrderEffect("alice", 0);
				port.trayLayers = [burger.id];
				yield* TestClock.adjust(Duration.millis(7));
				yield* sessionManager.nextDishEffect("alice");
				return sessionManager.getSealedDishes("alice")[0]?.frozenAt;
			}),
		);

		expect(result).toBe(ORDER_CONFIG.SPAWN_INTERVAL_MS + 7);
	});
});
