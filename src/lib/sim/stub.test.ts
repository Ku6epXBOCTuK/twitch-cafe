import { Duration, Effect, Fiber, Layer, Queue, Result, Scope } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { INGREDIENTS } from "../core/data/menu";
import {
	burger,
	BURGER_IDS,
	cola,
	makeOrder as makeTestOrder,
} from "#lib/test-support";
import { CANCEL_REASON } from "../core/game/sim-dto";
import { makeSimEventQueue } from "../core/game/sim-port";
import { SessionManager } from "../core/game/session-manager";
import { DEFAULT_GAME_CONFIG, GameConfig } from "../core/game/game-config";
import { connectSim } from "./sync";
import { StubSim } from "./stub";

const ALLOWED = new Set([...BURGER_IDS, cola.id]);
const makeOrder = () => makeTestOrder({ id: "o1", items: [burger] });

function setup() {
	const eventQueue = makeSimEventQueue();
	const sim = new StubSim(eventQueue, { allowedIngredientIds: ALLOWED });
	return { eventQueue, sim };
}

function taskResult(
	sim: StubSim,
	username: string,
	intent: Parameters<StubSim["enqueueTask"]>[1],
) {
	return Effect.runSync(Effect.result(sim.enqueueTask(username, intent)));
}

function takeEvent(eventQueue: ReturnType<typeof makeSimEventQueue>) {
	return Effect.runSync(Queue.take(eventQueue));
}

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

describe("StubSim: enqueueTask", () => {
	it("на несуществующего персонажа — SimTaskRefused без события", () => {
		const { eventQueue, sim } = setup();
		const result = taskResult(sim, "ghost", {
			kind: "put",
			ingredientId: INGREDIENTS.patty.id,
		});

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toMatchObject({
				_tag: "SimTaskRefused",
				reason: "no_character",
			});
		}
		expect(Effect.runSync(Queue.size(eventQueue))).toBe(0);
	});

	it("put кладёт ингредиент, ставит ACTION_COMPLETED в bounded queue", () => {
		const { eventQueue, sim } = setup();
		sim.startOrder("alice", makeOrder());

		const result = taskResult(sim, "alice", {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});
		expect(Result.isSuccess(result)).toBe(true);
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([
			INGREDIENTS.cheese.id,
		]);
		expect(takeEvent(eventQueue)).toMatchObject({
			type: "ACTION_COMPLETED",
			username: "alice",
			orderId: "o1",
			sequence: 1,
			action: { kind: "put", ingredientId: INGREDIENTS.cheese.id },
		});
	});

	it("неизвестный ингредиент — SimTaskRefused без события", () => {
		const { eventQueue, sim } = setup();
		sim.startOrder("alice", makeOrder());

		const result = taskResult(sim, "alice", {
			kind: "put",
			ingredientId: "iron",
		});
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toMatchObject({
				_tag: "SimTaskRefused",
				reason: "unknown_ingredient",
			});
		}
		expect(Effect.runSync(Queue.size(eventQueue))).toBe(0);
	});

	it("serve пустого подноса — SimTaskRefused без события", () => {
		const { eventQueue, sim } = setup();
		sim.startOrder("alice", makeOrder());

		const result = taskResult(sim, "alice", { kind: "serve" });
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure).toMatchObject({
				_tag: "SimTaskRefused",
				reason: "tray_empty",
			});
		}
		expect(Effect.runSync(Queue.size(eventQueue))).toBe(0);
	});

	it("serve замораживает снимок слоёв в событии", () => {
		const { eventQueue, sim } = setup();
		sim.startOrder("alice", makeOrder());
		taskResult(sim, "alice", { kind: "put", ingredientId: cola.id });
		takeEvent(eventQueue);

		const result = taskResult(sim, "alice", { kind: "serve" });
		expect(Result.isSuccess(result)).toBe(true);
		const serveEvent = takeEvent(eventQueue);
		expect(serveEvent).toMatchObject({ type: "ACTION_COMPLETED" });
		expect(serveEvent).toMatchObject({
			tray: { username: "alice", layers: [cola.id] },
		});
	});

	it("bin очищает поднос", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		taskResult(sim, "alice", {
			kind: "put",
			ingredientId: INGREDIENTS.patty.id,
		});

		const result = taskResult(sim, "alice", { kind: "bin" });
		expect(Result.isSuccess(result)).toBe(true);
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);
	});
});

describe("StubSim: bounded queue", () => {
	it("не превышает capacity и завершает producer после освобождения", () => {
		const eventQueue = makeSimEventQueue(1);
		const sim = new StubSim(eventQueue, { allowedIngredientIds: ALLOWED });
		sim.startOrder("alice", makeOrder());

		const first = taskResult(sim, "alice", {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});
		expect(Result.isSuccess(first)).toBe(true);
		expect(Effect.runSync(Queue.size(eventQueue))).toBe(1);

		const second = Effect.runFork(
			sim.enqueueTask("alice", {
				kind: "put",
				ingredientId: INGREDIENTS.patty.id,
			}),
		);
		takeEvent(eventQueue);
		Effect.runSync(Fiber.join(second));
		expect(Effect.runSync(Queue.size(eventQueue))).toBe(1);
	});

	it("после shutdown enqueueTask возвращает SimQueueClosed", () => {
		const { eventQueue, sim } = setup();
		sim.startOrder("alice", makeOrder());
		Effect.runSync(Queue.shutdown(eventQueue));

		const result = taskResult(sim, "alice", {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure._tag).toBe("SimQueueClosed");
		}
	});
});

describe("StubSim: жизненный цикл", () => {
	it("новый заказ сбрасывает слои подноса", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		taskResult(sim, "alice", {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});

		sim.startOrder("alice", makeOrder());
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);
	});

	it("cancelOrder чистит поднос; despawn ставит CHARACTER_REMOVED в queue", () => {
		const { eventQueue, sim } = setup();
		sim.startOrder("alice", makeOrder());
		taskResult(sim, "alice", {
			kind: "put",
			ingredientId: INGREDIENTS.patty.id,
		});
		takeEvent(eventQueue);

		sim.cancelOrder("alice", CANCEL_REASON.TIMEOUT);
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);

		Effect.runSync(sim.despawn("alice"));
		expect(sim.getTraySnapshot("alice")).toBeUndefined();
		expect(takeEvent(eventQueue)).toMatchObject({
			type: "CHARACTER_REMOVED",
			username: "alice",
		});
	});
});

describe("StubSim: снапшот", () => {
	it("getSnapshot возвращает всех персонажей со слоями", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		taskResult(sim, "alice", { kind: "put", ingredientId: cola.id });
		sim.startOrder("bob", makeOrder());

		const snapshot = sim.getSnapshot();
		expect(snapshot.characters).toHaveLength(2);
		const alice = snapshot.characters.find(
			(entry) => entry.username === "alice",
		);
		expect(alice?.tray).toEqual([cola.id]);
	});
});

describe("sync: связка порт ↔ SessionManager", () => {
	const fixedBurgerOrder = () =>
		makeTestOrder({ id: "o-fixed", items: [burger] });

	it("connectSim соединяет слои: у игрока появляется персонаж с подносом", async () => {
		const sm = new SessionManager();
		const port = connectSim(sm);

		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(DEFAULT_GAME_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);
				expect(port.getTraySnapshot("alice")?.layers).toEqual([]);
			}),
		);
	});

	it("полный цикл через порт: put ×4 → serve → XP и вердикт", async () => {
		const sm = new SessionManager(fixedBurgerOrder);
		const port = connectSim(sm);

		await run(
			sm,
			Effect.gen(function* () {
				yield* sm.startEffect();
				yield* TestClock.adjust(
					Duration.millis(DEFAULT_GAME_CONFIG.SPAWN_INTERVAL_MS),
				);
				yield* sm.takeOrderEffect("alice", 0);

				for (const id of BURGER_IDS) {
					yield* sm.putIngredientEffect("alice", id);
				}
				expect(port.getTraySnapshot("alice")?.layers).toEqual(BURGER_IDS);

				yield* sm.serveEffect("alice");
				const result = sm.getLastResult("alice");
				expect(result).not.toBeNull();
				expect(sm.getXp("alice")).toBe(result?.xpDelta);
			}),
		);
	});
});
