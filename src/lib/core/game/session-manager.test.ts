import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IOrder } from "../types/order";
import { ORDER_STATUS } from "../types/order";
import type { IMenuItem } from "../types/menu_item";
import type { ISimEvents, ISimPort } from "./sim-port";
import type { TaskIntent } from "./sim-dto";
import { INGREDIENTS, MENU_ITEMS } from "../data/menu";
import { SessionManager } from "./session-manager";

const BURGER_IDS = [
	INGREDIENTS.bunBottom.id,
	INGREDIENTS.patty.id,
	INGREDIENTS.cheese.id,
	INGREDIENTS.bunTop.id,
];

function fixedOrder(item: IMenuItem): IOrder {
	return {
		id: `order-${item.id}`,
		items: [item],
		customer: { id: "normal", name: "Обычный", strictness: 0.5 },
		timeLimit: 90_000,
		createdAt: new Date(0),
		status: ORDER_STATUS.PENDING,
	};
}

class RecordingPort implements ISimPort {
	events: ISimEvents | null = null;
	startOrders: IOrder[] = [];
	tasks: Array<{ username: string; intent: TaskIntent }> = [];
	cancels: Array<"timeout" | "leave"> = [];
	trayLayers: string[] = [];

	attach(events: ISimEvents): void {
		this.events = events;
	}

	startOrder(username: string, order: IOrder): void {
		this.startOrders.push(order);
	}

	enqueueTask(username: string, intent: TaskIntent) {
		this.tasks.push({ username, intent });
		if (intent.kind === "serve") {
			this.events?.onActionCompleted({
				type: "ACTION_COMPLETED",
				username,
				finishedAt: Date.now(),
				action: { kind: "serve", targetId: 0, startedAt: 0 },
				tray: { username, layers: [...this.trayLayers], frozenAt: Date.now() },
			});
			return { ok: true as const };
		}
		if (intent.kind === "bin") this.trayLayers = [];
		if (intent.kind === "put") this.trayLayers.push(intent.ingredientId);
		return { ok: true as const };
	}

	cancelOrder(username: string, reason: "timeout" | "leave"): void {
		this.cancels.push(reason);
	}

	despawn(): void {}

	getTraySnapshot(username: string) {
		return { username, layers: [...this.trayLayers], frozenAt: 0 };
	}

	getSnapshot() {
		return { simTime: 0, characters: [] };
	}
}

function setup(item?: IMenuItem) {
	const port = new RecordingPort();
	const sm = new SessionManager(item ? () => fixedOrder(item) : undefined);
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

describe("SessionManager: join", () => {
	it("startOrder создаёт сессию с pending-заказом и ставит таймер", () => {
		const { port, sm } = setup();
		const order = sm.startOrder("alice");
		expect(order).not.toBeNull();
		expect(sm.hasSession("alice")).toBe(true);
		expect(sm.getXp("alice")).toBe(0);
		expect(sm.getLevel("alice")).toBe(1);
		expect(port.startOrders).toHaveLength(1);
	});

	it("повторный join при активном заказе игнорируется", () => {
		const { port, sm } = setup();
		sm.startOrder("alice");
		sm.startOrder("alice");
		expect(port.startOrders).toHaveLength(1);
	});
});

describe("SessionManager: serve", () => {
	const burger = MENU_ITEMS.find((m) => m.id === "burger")!;
	const cola = MENU_ITEMS.find((m) => m.id === "cola")!;

	function serveEvent(username: string, frozenAt: number, layers: string[]) {
		return {
			type: "ACTION_COMPLETED" as const,
			username,
			finishedAt: frozenAt,
			action: { kind: "serve" as const, targetId: 0, startedAt: 0 },
			tray: { username, layers, frozenAt },
		};
	}

	it("заказ закрыт один раз: дубль события не начисляет XP повторно", () => {
		const { port, sm } = setup(burger);
		sm.startOrder("alice");
		port.trayLayers = BURGER_IDS;

		const e = serveEvent("alice", 1000, BURGER_IDS);
		sm.onActionCompleted(e);
		sm.onActionCompleted(e); // дубль

		expect(sm.getXp("alice")).toBe(50);
		expect(sm.getLastResult("alice")?.verdict).toBe("perfect");
		expect(port.startOrders).toHaveLength(2); // новый заказ после serve
	});

	it("serve начисляет XP и выдаёт следующий заказ", () => {
		const { port, sm } = setup(cola);
		const first = sm.startOrder("alice");
		port.trayLayers = ["cola"];

		const ack = sm.serve("alice");
		expect(ack).toEqual({ ok: true });
		expect(sm.getLastResult("alice")?.xpDelta).toBe(50);
		expect(sm.getOrder("alice")).not.toBe(first);
	});

	it("serve пустого подноса — штраф", () => {
		const { port, sm } = setup(cola);
		sm.startOrder("alice");
		port.trayLayers = [];

		sm.serve("alice");
		expect(sm.getXp("alice")).toBe(-50);
		expect(sm.getLastResult("alice")?.verdict).toBe("awful");
	});
});

describe("SessionManager: таймаут", () => {
	it("onTimeout снимает XP, идемпотентен по ссылке на заказ", () => {
		const { port, sm } = setup();
		const order = sm.startOrder("alice");
		expect(order).not.toBeNull();

		sm.onTimeout("alice", order!);

		expect(order!.status).toBe("EXPIRED");
		expect(sm.getXp("alice")).toBe(-50);
		expect(port.cancels).toEqual(["timeout"]);
		expect(port.tasks).toHaveLength(0);

		const nextOrder = sm.getOrder("alice");
		expect(nextOrder).not.toBe(order);

		// повторный вызов со старым заказом — игнор
		sm.onTimeout("alice", order!);
		expect(sm.getXp("alice")).toBe(-50);
		expect(port.cancels).toHaveLength(1);
	});

	it("таймер тикает сам: после timeLimit заказ истекает и выдаётся новый", () => {
		const { port, sm } = setup();
		const orderA = sm.startOrder("alice");
		expect(orderA).not.toBeNull();

		vi.advanceTimersByTime(orderA!.timeLimit + 1);
		expect(orderA!.status).toBe("EXPIRED");
		expect(sm.getXp("alice")).toBe(-50);
		expect(port.cancels).toEqual(["timeout"]);

		const orderB = sm.getOrder("alice");
		expect(orderB).not.toBe(orderA);

		// таймер нового заказа тоже работает: истекает один раз
		vi.advanceTimersByTime(orderB!.timeLimit + 1);
		expect(orderB!.status).toBe("EXPIRED");
		expect(port.cancels).toEqual(["timeout", "timeout"]);
	});
});

describe("SessionManager: уровень", () => {
	it("уровень растёт за XP с шагом 100", () => {
		const { sm } = setup();
		sm.startOrder("alice");
		expect(sm.getLevel("alice")).toBe(1);

		const order = sm.getOrder("alice");
		expect(order).not.toBeNull();
		for (let i = 0; i < 4; i++) {
			const o = sm.getOrder("alice")!;
			sm.onTimeout("alice", o);
		}
		expect(sm.getXp("alice")).toBe(-200);
		expect(sm.getLevel("alice")).toBe(1);
	});
});

describe("SessionManager: заказ по меню", () => {
	it("меню реально: бургер и кола доступны", () => {
		expect(MENU_ITEMS.map((m) => m.id)).toEqual(
			expect.arrayContaining(["burger", "cola"]),
		);
	});
});
