import { Effect, Queue, Result } from "effect";
import { describe, expect, it } from "vitest";
import { INGREDIENTS } from "../core/data/menu";
import { makeSimEventQueue } from "../core/game/sim-port";
import { burger, BURGER_IDS, cola, makeOrder } from "#lib/test-support";
import { MiniplexSim } from "./simulation";

const ALLOWED = new Set([...BURGER_IDS, cola.id]);

function setup() {
	const eventQueue = makeSimEventQueue();
	const sim = new MiniplexSim(eventQueue, {
		allowedIngredientIds: ALLOWED,
		speed: 100,
	});
	sim.startOrder("alice", makeOrder({ id: "order-1", items: [burger] }));
	return { eventQueue, sim };
}

function taskResult(
	sim: MiniplexSim,
	intent: Parameters<MiniplexSim["enqueueTask"]>[1],
) {
	return Effect.runSync(Effect.result(sim.enqueueTask("alice", intent)));
}

function tick(sim: MiniplexSim, deltaMs = 50): void {
	Effect.runSync(sim.tick(deltaMs));
}

function takeEvent(eventQueue: ReturnType<typeof makeSimEventQueue>) {
	return Effect.runSync(Queue.take(eventQueue));
}

describe("MiniplexSim", () => {
	it("создаёт chef и tray через miniplex world", () => {
		const { sim } = setup();

		expect(sim.getSnapshot()).toMatchObject({
			simTime: 0,
			characters: [
				{
					username: "alice",
					x: 0,
					y: 0,
					tray: [],
				},
			],
		});
	});

	it("принимает put, двигается к станции и завершает действие на tick", () => {
		const { eventQueue, sim } = setup();

		const result = taskResult(sim, {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});
		expect(Result.isSuccess(result)).toBe(true);
		expect(sim.getSnapshot().characters[0]?.action).toMatchObject({
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});
		expect(takeEvent(eventQueue)).toMatchObject({
			type: "ACTION_STARTED",
			username: "alice",
		});

		tick(sim);
		expect(sim.getSnapshot().characters[0]?.action).toBeUndefined();
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([
			INGREDIENTS.cheese.id,
		]);
		expect(takeEvent(eventQueue)).toMatchObject({
			type: "ACTION_COMPLETED",
			username: "alice",
			orderId: "order-1",
			action: { kind: "put", ingredientId: INGREDIENTS.cheese.id },
		});
	});

	it("отказывает в занятом персонаже и пустом serve", () => {
		const { sim } = setup();

		expect(
			Result.isSuccess(
				taskResult(sim, {
					kind: "put",
					ingredientId: INGREDIENTS.patty.id,
				}),
			),
		).toBe(true);
		const busy = taskResult(sim, {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});
		expect(Result.isFailure(busy)).toBe(true);
		if (Result.isFailure(busy)) {
			expect(busy.failure).toMatchObject({ reason: "busy" });
		}

		const { sim: emptySim } = setup();
		const empty = taskResult(emptySim, { kind: "serve" });
		expect(Result.isFailure(empty)).toBe(true);
		if (Result.isFailure(empty)) {
			expect(empty.failure).toMatchObject({ reason: "tray_empty" });
		}
	});

	it("bin очищает поднос, а serve возвращает его снимок", () => {
		const { eventQueue, sim } = setup();
		taskResult(sim, { kind: "put", ingredientId: cola.id });
		takeEvent(eventQueue);
		tick(sim, 50);
		takeEvent(eventQueue);

		taskResult(sim, { kind: "bin" });
		takeEvent(eventQueue);
		tick(sim, 100);
		takeEvent(eventQueue);
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);

		taskResult(sim, { kind: "put", ingredientId: cola.id });
		takeEvent(eventQueue);
		tick(sim, 100);
		takeEvent(eventQueue);
		taskResult(sim, { kind: "serve" });
		takeEvent(eventQueue);
		tick(sim, 200);
		expect(takeEvent(eventQueue)).toMatchObject({
			type: "ACTION_COMPLETED",
			action: { kind: "serve" },
			tray: { username: "alice", layers: [cola.id] },
		});
	});

	it("despawn удаляет персонажа и публикует событие", () => {
		const { eventQueue, sim } = setup();

		Effect.runSync(sim.despawn("alice"));

		expect(sim.getSnapshot().characters).toEqual([]);
		expect(takeEvent(eventQueue)).toEqual({
			type: "CHARACTER_REMOVED",
			username: "alice",
		});
	});
});
