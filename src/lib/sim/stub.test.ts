import { describe, expect, it } from "vitest";
import { INGREDIENTS } from "../core/data/menu";
import {
	burger,
	BURGER_IDS,
	cola,
	makeOrder as makeTestOrder,
} from "#lib/test-support";
import type { ISimEvents } from "../core/game/sim-port";
import type {
	ActionCompletedEvent,
	ActionStartedEvent,
	CharacterRemovedEvent,
	SimOutEvent,
} from "../core/game/sim-dto";
import { SessionManager } from "../core/game/session-manager";
import { connectSim } from "./sync";
import { StubSim } from "./stub";

const ALLOWED = new Set([...BURGER_IDS, cola.id]);
const makeOrder = () => makeTestOrder({ id: "o1", items: [burger] });

class RecordingEvents implements ISimEvents {
	events: SimOutEvent[] = [];

	onActionStarted(e: ActionStartedEvent) {
		this.events.push(e);
	}
	onActionCompleted(e: ActionCompletedEvent) {
		this.events.push(e);
	}
	onCharacterRemoved(e: CharacterRemovedEvent) {
		this.events.push(e);
	}
}

function setup() {
	const events = new RecordingEvents();
	const sim = new StubSim(events, { allowedIngredientIds: ALLOWED });
	return { events, sim };
}

describe("StubSim: enqueueTask", () => {
	it("на несуществующего персонажа — no_character без события", () => {
		const { events, sim } = setup();
		expect(
			sim.enqueueTask("ghost", {
				kind: "put",
				ingredientId: INGREDIENTS.patty.id,
			}),
		).toEqual({
			ok: false,
			reason: "no_character",
		});
		expect(events.events).toHaveLength(0);
	});

	it("put кладёт ингредиент, шлёт ACTION_COMPLETED", () => {
		const { events, sim } = setup();
		sim.startOrder("alice", makeOrder());

		const ack = sim.enqueueTask("alice", {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});
		expect(ack).toEqual({ ok: true });
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([
			INGREDIENTS.cheese.id,
		]);
		expect(events.events).toHaveLength(1);
		expect(events.events[0]).toMatchObject({
			type: "ACTION_COMPLETED",
			username: "alice",
			action: { kind: "put", ingredientId: INGREDIENTS.cheese.id },
		});
	});

	it("неизвестный ингредиент — unknown_ingredient без события", () => {
		const { events, sim } = setup();
		sim.startOrder("alice", makeOrder());

		expect(
			sim.enqueueTask("alice", { kind: "put", ingredientId: "iron" }),
		).toEqual({
			ok: false,
			reason: "unknown_ingredient",
		});
		expect(events.events).toHaveLength(0);
	});

	it("serve пустого подноса — tray_empty без события", () => {
		const { events, sim } = setup();
		sim.startOrder("alice", makeOrder());

		expect(sim.enqueueTask("alice", { kind: "serve" })).toEqual({
			ok: false,
			reason: "tray_empty",
		});
		expect(events.events).toHaveLength(0);
	});

	it("serve замораживает снимок слоёв в событии", () => {
		const { events, sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", { kind: "put", ingredientId: cola.id });

		expect(sim.enqueueTask("alice", { kind: "serve" })).toEqual({ ok: true });
		const serveEvent = events.events[1];
		expect(serveEvent).toMatchObject({ type: "ACTION_COMPLETED" });
		expect((serveEvent as { tray?: unknown }).tray).toMatchObject({
			username: "alice",
			layers: [cola.id],
		});
	});

	it("bin очищает поднос", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", {
			kind: "put",
			ingredientId: INGREDIENTS.patty.id,
		});

		expect(sim.enqueueTask("alice", { kind: "bin" })).toEqual({ ok: true });
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);
	});
});

describe("StubSim: жизненный цикл", () => {
	it("новый заказ сбрасывает слои подноса", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", {
			kind: "put",
			ingredientId: INGREDIENTS.cheese.id,
		});

		sim.startOrder("alice", makeOrder());
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);
	});

	it("cancelOrder чистит поднос; despawn шлёт CHARACTER_REMOVED и удаляет", () => {
		const { events, sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", {
			kind: "put",
			ingredientId: INGREDIENTS.patty.id,
		});

		sim.cancelOrder("alice", "timeout");
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);

		sim.despawn("alice");
		expect(sim.getTraySnapshot("alice")).toBeUndefined();
		expect(events.events.at(-1)).toMatchObject({
			type: "CHARACTER_REMOVED",
			username: "alice",
		});
	});
});

describe("StubSim: снапшот", () => {
	it("getSnapshot возвращает всех персонажей со слоями", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", { kind: "put", ingredientId: cola.id });
		sim.startOrder("bob", makeOrder());

		const snapshot = sim.getSnapshot();
		expect(snapshot.characters).toHaveLength(2);
		const alice = snapshot.characters.find((c) => c.username === "alice");
		expect(alice?.tray).toEqual([cola.id]);
	});
});

describe("sync: связка порт ↔ SessionManager", () => {
	const fixedBurgerOrder = () =>
		makeTestOrder({ id: "o-fixed", items: [burger] });
	it("connectSim соединяет слои: у игрока появляется персонаж с подносом", () => {
		const sm = new SessionManager();
		const port = connectSim(sm);

		sm.incomingOrders.spawn();
		const res = sm.takeOrder("alice", 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);
		expect(port.getTraySnapshot("alice")?.layers).toEqual([]);
	});

	it("полный цикл через порт: put ×4 → serve → XP и вердикт", () => {
		const sm = new SessionManager(fixedBurgerOrder);
		const port = connectSim(sm);
		sm.incomingOrders.spawn();
		const res = sm.takeOrder("alice", 0);
		if (!res.ok) throw new Error(`takeOrder failed: ${res.reason}`);

		for (const id of BURGER_IDS) {
			expect(sm.putIngredient("alice", id)).toEqual({ ok: true });
		}
		expect(port.getTraySnapshot("alice")?.layers).toEqual(BURGER_IDS);

		expect(sm.serve("alice")).toEqual({ ok: true });
		const result = sm.getLastResult("alice");
		expect(result).not.toBeNull();
		expect(sm.getXp("alice")).toBe(result?.xpDelta);
	});
});
