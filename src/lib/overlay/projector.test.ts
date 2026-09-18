import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IMenuItem } from "../core/types/menu_item";
import type { IOrder } from "../core/types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../core/types/order";
import { MENU_ITEMS } from "../core/data/menu";
import type { ISimEvents, ISimPort } from "../core/game/sim-port";
import type { TaskIntent } from "../core/game/sim-dto";
import { SessionManager } from "../core/game/session-manager";
import { project } from "./projector";

const BURGER = MENU_ITEMS.find((m) => m.id === "burger")!;
const COLA = MENU_ITEMS.find((m) => m.id === "cola")!;
const BURGER_IDS = ["bun_bottom", "patty", "cheese", "bun_top"];

const CREATED_AT_MS = 1000;
const TIME_LIMIT_MS = 90_000;
const DEADLINE_MS = CREATED_AT_MS + TIME_LIMIT_MS;

function makeOrder(id: string, items: IMenuItem[], strictness = 0.5): IOrder {
	return {
		id,
		items: items.map((item) => ({ item, state: ORDER_ITEM_STATE.PENDING })),
		customer: { id: "normal", name: "Обычный", strictness },
		timeLimit: TIME_LIMIT_MS,
		createdAt: new Date(CREATED_AT_MS),
		status: ORDER_STATUS.PENDING,
	};
}

/** Порт-заглушка: копит слои подноса, serve отдаёт снапшот в SM. */
class RecordingPort implements ISimPort {
	events: ISimEvents | null = null;
	trayLayers: string[] = [];

	attach(events: ISimEvents): void {
		this.events = events;
	}

	startOrder(): void {}

	enqueueTask(username: string, intent: TaskIntent) {
		if (intent.kind === "serve") {
			this.events?.onActionCompleted({
				type: "ACTION_COMPLETED",
				username,
				finishedAt: Date.now(),
				action: { kind: "serve", targetId: 0, startedAt: 0 },
				tray: {
					username,
					layers: [...this.trayLayers],
					frozenAt: Date.now(),
				},
			});
			this.trayLayers = [];
			return { ok: true as const };
		}
		if (intent.kind === "bin") this.trayLayers = [];
		if (intent.kind === "put") this.trayLayers.push(intent.ingredientId);
		return { ok: true as const };
	}

	cancelOrder(): void {}

	clearTray(): void {
		this.trayLayers = [];
	}

	despawn(): void {}

	getTraySnapshot(username: string) {
		return { username, layers: [...this.trayLayers], frozenAt: 0 };
	}

	getSnapshot() {
		return { simTime: 0, characters: [] };
	}
}

/** SM с фиксированной очередью заказов: `spawn()` берёт следующий. */
function setup(orders: IOrder[]) {
	const port = new RecordingPort();
	let index = 0;
	const sm = new SessionManager(() => orders[index++]!);
	sm.attachPort(port);
	port.attach(sm);
	return { port, sm };
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("project: incoming", () => {
	it("непустые слоты → имена блюд, strictness, deadline", () => {
		const { sm } = setup([
			makeOrder("o1", [BURGER], 0.2),
			makeOrder("o2", [COLA, COLA], 0.9),
		]);
		sm.incomingOrders.spawn();
		sm.incomingOrders.spawn();

		expect(project(sm).incoming).toEqual([
			{
				slot: 1,
				id: "o1",
				dishes: ["Бургер"],
				strictness: 0.2,
				deadline: DEADLINE_MS,
			},
			{
				slot: 2,
				id: "o2",
				dishes: ["Кола", "Кола"],
				strictness: 0.9,
				deadline: DEADLINE_MS,
			},
		]);
	});

	it("взятый слот исчезает из incoming, номера слотов не сдвигаются", () => {
		const { sm } = setup([makeOrder("o1", [BURGER]), makeOrder("o2", [COLA])]);
		sm.incomingOrders.spawn();
		sm.incomingOrders.spawn();

		expect(sm.takeOrder("alice", 0)).toMatchObject({ ok: true });
		expect(project(sm).incoming).toEqual([
			{
				slot: 2,
				id: "o2",
				dishes: ["Кола"],
				strictness: 0.5,
				deadline: DEADLINE_MS,
			},
		]);
	});
});

describe("project: execution и players", () => {
	it("сессия с двумя блюдами: dishes и order до/после !next", () => {
		const { port, sm } = setup([makeOrder("o1", [BURGER, COLA])]);
		sm.incomingOrders.spawn();
		sm.takeOrder("alice", 0);

		expect(project(sm).execution).toEqual([
			{
				id: "o1",
				performer: "alice",
				dishes: [
					{ name: "Бургер", done: false },
					{ name: "Кола", done: false },
				],
				deadline: DEADLINE_MS,
			},
		]);
		expect(project(sm).players).toEqual([
			{
				username: "alice",
				x: 0,
				y: 0,
				order: {
					dishes: [
						{ kind: "burger", done: false },
						{ kind: "drink", done: false },
					],
				},
			},
		]);

		port.trayLayers = BURGER_IDS;
		expect(sm.nextDish("alice")).toEqual({ ok: true });

		expect(project(sm).execution[0].dishes).toEqual([
			{ name: "Бургер", done: true },
			{ name: "Кола", done: false },
		]);
		expect(project(sm).players[0].order).toEqual({
			dishes: [
				{ kind: "burger", done: true },
				{ kind: "drink", done: false },
			],
		});
	});

	it("после serve: исполнителя нет, игрок остаётся с order: null", () => {
		const { port, sm } = setup([makeOrder("o1", [BURGER, COLA])]);
		sm.incomingOrders.spawn();
		sm.takeOrder("alice", 0);
		port.trayLayers = BURGER_IDS;
		sm.nextDish("alice");
		port.trayLayers = ["cola"];

		expect(sm.serve("alice")).toEqual({ ok: true });
		const snapshot = project(sm);
		expect(snapshot.execution).toEqual([]);
		expect(snapshot.players).toEqual([
			{ username: "alice", x: 0, y: 0, order: null },
		]);
	});

	it("после timeout: исполнителя нет, игрок остаётся с order: null", () => {
		const { sm } = setup([makeOrder("o1", [COLA])]);
		sm.incomingOrders.spawn();
		const taken = sm.takeOrder("alice", 0);
		if (!taken.ok) throw new Error("takeOrder failed");

		sm.onTimeout("alice", taken.order);
		const snapshot = project(sm);
		expect(snapshot.execution).toEqual([]);
		expect(snapshot.players).toEqual([
			{ username: "alice", x: 0, y: 0, order: null },
		]);
	});
});

describe("project: recipe", () => {
	it("без show → null; бургер → ингредиенты; кола → пустой список", () => {
		const { sm } = setup([]);

		expect(project(sm).recipe).toBeNull();

		sm.recipeBook.show(BURGER);
		expect(project(sm).recipe).toEqual({
			id: "burger",
			name: "Бургер",
			ingredients: ["Нижняя булочка", "Котлета", "Сыр", "Верхняя булочка"],
		});

		sm.recipeBook.show(COLA);
		expect(project(sm).recipe).toEqual({
			id: "cola",
			name: "Кола",
			ingredients: [],
		});
	});
});
