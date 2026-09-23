import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import {
	burger,
	BURGER_IDS,
	cola,
	makeOrder,
	RecordingPort,
} from "#lib/test-support";
import { SessionManager } from "../core/game/session-manager";
import { project } from "./projector";

const CREATED_AT_MS = 1000;
const DEADLINE_MS = CREATED_AT_MS + ORDER_CONFIG.ORDER_TIME_LIMIT_MS;

function setup(orders: ReturnType<typeof makeOrder>[]) {
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
			makeOrder({
				id: "o1",
				items: [burger],
				strictness: 0.2,
				createdAt: new Date(CREATED_AT_MS),
			}),
			makeOrder({
				id: "o2",
				items: [cola, cola],
				strictness: 0.9,
				createdAt: new Date(CREATED_AT_MS),
			}),
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
		const { sm } = setup([
			makeOrder({
				id: "o1",
				items: [burger],
				createdAt: new Date(CREATED_AT_MS),
			}),
			makeOrder({
				id: "o2",
				items: [cola],
				createdAt: new Date(CREATED_AT_MS),
			}),
		]);
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
		const { port, sm } = setup([
			makeOrder({
				id: "o1",
				items: [burger, cola],
				createdAt: new Date(CREATED_AT_MS),
			}),
		]);
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
		const { port, sm } = setup([
			makeOrder({
				id: "o1",
				items: [burger, cola],
				createdAt: new Date(CREATED_AT_MS),
			}),
		]);
		sm.incomingOrders.spawn();
		sm.takeOrder("alice", 0);
		port.trayLayers = BURGER_IDS;
		sm.nextDish("alice");
		port.trayLayers = [cola.id];

		expect(sm.serve("alice")).toEqual({ ok: true });
		const snapshot = project(sm);
		expect(snapshot.execution).toEqual([]);
		expect(snapshot.players).toEqual([
			{ username: "alice", x: 0, y: 0, order: null },
		]);
	});

	it("после timeout: исполнителя нет, игрок остаётся с order: null", () => {
		const { sm } = setup([
			makeOrder({
				id: "o1",
				items: [cola],
				createdAt: new Date(CREATED_AT_MS),
			}),
		]);
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

		sm.recipeBook.show(burger);
		expect(project(sm).recipe).toEqual({
			id: "burger",
			name: "Бургер",
			ingredients: ["Нижняя булочка", "Котлета", "Сыр", "Верхняя булочка"],
		});

		sm.recipeBook.show(cola);
		expect(project(sm).recipe).toEqual({
			id: "cola",
			name: "Кола",
			ingredients: [],
		});
	});
});
