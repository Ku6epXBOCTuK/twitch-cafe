import { describe, expect, it } from "vitest";
import type { ISimEvents } from "../core/game/sim-port";
import type {
	ActionCompletedEvent,
	ActionStartedEvent,
	CharacterRemovedEvent,
	SimOutEvent,
} from "../core/game/sim-dto";
import { ORDER_STATUS } from "../core/types/order";
import type { IOrder } from "../core/types/order";
import { MENU_ITEMS } from "../core/data/menu";
import { SessionManager } from "../core/game/session-manager";
import { connectSim } from "./sync";
import { StubSim } from "./stub";

const ALLOWED = new Set(["bun_bottom", "patty", "cheese", "bun_top", "cola"]);

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

function makeOrder(): IOrder {
	return {
		id: "o1",
		items: [MENU_ITEMS[0]],
		customer: { id: "normal", name: "Обычный", strictness: 0.5 },
		timeLimit: 90_000,
		createdAt: new Date(0),
		status: ORDER_STATUS.PENDING,
	};
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
			sim.enqueueTask("ghost", { kind: "put", ingredientId: "patty" }),
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
			ingredientId: "cheese",
		});
		expect(ack).toEqual({ ok: true });
		expect(sim.getTraySnapshot("alice")?.layers).toEqual(["cheese"]);
		expect(events.events).toHaveLength(1);
		expect(events.events[0]).toMatchObject({
			type: "ACTION_COMPLETED",
			username: "alice",
			action: { kind: "put", ingredientId: "cheese" },
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
		sim.enqueueTask("alice", { kind: "put", ingredientId: "cola" });

		expect(sim.enqueueTask("alice", { kind: "serve" })).toEqual({ ok: true });
		const serveEvent = events.events[1];
		expect(serveEvent).toMatchObject({ type: "ACTION_COMPLETED" });
		expect((serveEvent as { tray?: unknown }).tray).toMatchObject({
			username: "alice",
			layers: ["cola"],
		});
	});

	it("bin очищает поднос", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", { kind: "put", ingredientId: "patty" });

		expect(sim.enqueueTask("alice", { kind: "bin" })).toEqual({ ok: true });
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);
	});
});

describe("StubSim: жизненный цикл", () => {
	it("новый заказ сбрасывает слои подноса", () => {
		const { sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", { kind: "put", ingredientId: "cheese" });

		sim.startOrder("alice", makeOrder());
		expect(sim.getTraySnapshot("alice")?.layers).toEqual([]);
	});

	it("cancelOrder чистит поднос; despawn шлёт CHARACTER_REMOVED и удаляет", () => {
		const { events, sim } = setup();
		sim.startOrder("alice", makeOrder());
		sim.enqueueTask("alice", { kind: "put", ingredientId: "patty" });

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
		sim.enqueueTask("alice", { kind: "put", ingredientId: "cola" });
		sim.startOrder("bob", makeOrder());

		const snapshot = sim.getSnapshot();
		expect(snapshot.characters).toHaveLength(2);
		const alice = snapshot.characters.find((c) => c.username === "alice");
		expect(alice?.tray).toEqual(["cola"]);
	});
});

describe("sync: связка порт ↔ SessionManager", () => {
	const burger = MENU_ITEMS.find((m) => m.id === "burger")!;
	const BURGER_IDS = ["bun_bottom", "patty", "cheese", "bun_top"];

	function fixedBurgerOrder(): IOrder {
		return {
			id: "o-fixed",
			items: [burger],
			customer: { id: "normal", name: "Обычный", strictness: 0.5 },
			timeLimit: 90_000,
			createdAt: new Date(0),
			status: ORDER_STATUS.PENDING,
		};
	}

	it("connectSim соединяет слои: у игрока появляется персонаж с подносом", () => {
		const sm = new SessionManager();
		const port = connectSim(sm);

		const order = sm.startOrder("alice");
		expect(order).not.toBeNull();
		expect(port.getTraySnapshot("alice")?.layers).toEqual([]);
	});

	it("полный цикл через порт: put ×4 → serve → XP и вердикт", () => {
		const sm = new SessionManager(fixedBurgerOrder);
		const port = connectSim(sm);
		sm.startOrder("alice");

		for (const id of BURGER_IDS) {
			expect(sm.putIngredient("alice", id)).toEqual({ ok: true });
		}
		expect(port.getTraySnapshot("alice")?.layers).toEqual(BURGER_IDS);

		expect(sm.serve("alice")).toEqual({ ok: true });
		expect(sm.getLastResult("alice")?.verdict).toBe("perfect");
		expect(sm.getXp("alice")).toBe(50);
	});
});
