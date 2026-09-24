import { describe, expect, it } from "vitest";
import { ORDER_CONFIG } from "../core/config";
import type { IMenuItem } from "../core/types/menu_item";
import type { IOrder } from "../core/types/order";
import type {
	SessionSnapshot,
	SessionSnapshotPlayer,
} from "../core/game/session-manager";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../core/types/order";
import { burger, BURGER_IDS, cola, makeOrder } from "#lib/test-support";
import { projectSnapshot } from "./projector";

const CREATED_AT_MS = 1000;
const DEADLINE_MS = CREATED_AT_MS + ORDER_CONFIG.ORDER_TIME_LIMIT_MS;

function order(
	id: string,
	items: readonly IMenuItem[],
	status: IOrder["status"] = ORDER_STATUS.PENDING,
) {
	const result = makeOrder({
		id,
		items,
		createdAt: new Date(CREATED_AT_MS),
	});
	result.status = status;
	return result;
}

function player(
	username: string,
	activeOrder: ReturnType<typeof order>,
	overrides: Partial<SessionSnapshotPlayer> = {},
): SessionSnapshotPlayer {
	return {
		username,
		order: activeOrder,
		xp: 0,
		currentItemIndex: 0,
		sealed: [],
		lastResult: null,
		lastSequence: 0,
		...overrides,
	};
}

function snapshot(
	incoming: SessionSnapshot["incoming"],
	sessions: SessionSnapshot["sessions"] = [],
	recipe: SessionSnapshot["recipe"] = null,
): SessionSnapshot {
	return { incoming, sessions, recipe };
}

describe("projectSnapshot: incoming", () => {
	it("непустые слоты → имена блюд, strictness, deadline", () => {
		const first = order("o1", [burger]);
		first.customer.strictness = 0.2;
		const second = order("o2", [cola, cola]);
		second.customer.strictness = 0.9;

		const result = projectSnapshot(snapshot([first, null, second]));

		expect(result.incoming).toEqual([
			{
				slot: 1,
				id: "o1",
				dishes: ["Бургер"],
				strictness: 0.2,
				deadline: DEADLINE_MS,
			},
			{
				slot: 3,
				id: "o2",
				dishes: ["Кола", "Кола"],
				strictness: 0.9,
				deadline: DEADLINE_MS,
			},
		]);
	});

	it("взятый слот исчезает из incoming, номера слотов не сдвигаются", () => {
		const first = order("o1", [burger]);
		const second = order("o2", [cola]);
		const result = projectSnapshot(snapshot([null, second]));
		expect(result.incoming).toEqual([
			{
				slot: 2,
				id: "o2",
				dishes: ["Кола"],
				strictness: 0.5,
				deadline: DEADLINE_MS,
			},
		]);
		expect(first.id).toBe("o1");
	});
});

describe("projectSnapshot: execution и players", () => {
	it("сессия с двумя блюдами: dishes и order до/после !next", () => {
		const activeOrder = order("o1", [burger, cola]);
		const initial = projectSnapshot(
			snapshot([], [player("alice", activeOrder)]),
		);

		expect(initial.execution).toEqual([
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
		expect(initial.players).toEqual([
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

		activeOrder.items[0].state = ORDER_ITEM_STATE.SEALED;
		const afterNext = projectSnapshot(
			snapshot(
				[],
				[
					player("alice", activeOrder, {
						currentItemIndex: 1,
						sealed: [{ username: "alice", layers: BURGER_IDS, frozenAt: 2000 }],
					}),
				],
			),
		);

		expect(afterNext.execution[0].dishes).toEqual([
			{ name: "Бургер", done: true },
			{ name: "Кола", done: false },
		]);
		expect(afterNext.players[0].order).toEqual({
			dishes: [
				{ kind: "burger", done: true },
				{ kind: "drink", done: false },
			],
		});
	});

	it("после serve: исполнителя нет, игрок остаётся с order: null", () => {
		const completed = order("o1", [burger, cola], ORDER_STATUS.COMPLETED);
		const result = projectSnapshot(snapshot([], [player("alice", completed)]));
		expect(result.execution).toEqual([]);
		expect(result.players).toEqual([
			{ username: "alice", x: 0, y: 0, order: null },
		]);
	});

	it("после timeout: исполнителя нет, игрок остаётся с order: null", () => {
		const expired = order("o1", [cola], ORDER_STATUS.EXPIRED);
		const result = projectSnapshot(snapshot([], [player("alice", expired)]));
		expect(result.execution).toEqual([]);
		expect(result.players).toEqual([
			{ username: "alice", x: 0, y: 0, order: null },
		]);
	});
});

describe("projectSnapshot: recipe", () => {
	it("без recipe → null; бургер → ингредиенты; кола → пустой список", () => {
		expect(projectSnapshot(snapshot([], [], null)).recipe).toBeNull();
		expect(projectSnapshot(snapshot([], [], burger)).recipe).toEqual({
			id: "burger",
			name: "Бургер",
			ingredients: ["Нижняя булочка", "Котлета", "Сыр", "Верхняя булочка"],
		});
		expect(projectSnapshot(snapshot([], [], cola)).recipe).toEqual({
			id: "cola",
			name: "Кола",
			ingredients: [],
		});
	});
});
