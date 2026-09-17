import type { IOrder } from "../types/order";
import { ORDER_STATUS } from "../types/order";
import type { ISimEvents, ISimPort } from "./sim-port";
import type { TaskAck } from "./sim-dto";
import type { ActionCompletedEvent, CharacterRemovedEvent } from "./sim-dto";
import type { ITraySnapshot } from "../types/tray";
import type { AssessmentResult } from "../services/order-validator";
import { OrderValidator } from "../services/order-validator";
import { xpForRating } from "../services/scoring";
import { OrderFactory } from "../services/order-factory";
import { IncomingOrders } from "./incoming-orders";

export type TakeOrderResult =
	{ ok: true; order: IOrder } | { ok: false; reason: "busy" | "empty_slot" };

export type NextDishResult =
	| { ok: true }
	| {
			ok: false;
			reason: "no_order" | "last_item" | "tray_empty";
	  };

export interface PlayerSession {
	username: string;
	order: IOrder;
	xp: number;
	/** Индекс блюда, которое сейчас собирается на подносе. */
	currentItemIndex: number;
	/** Снапшоты запечатанных `!next`-ом блюд. */
	sealed: ITraySnapshot[];
	/** lastResult — вердикт последнего serve, для ответа в чат. */
	lastResult: AssessmentResult | null;
	timer: ReturnType<typeof setTimeout> | null;
	/** frozenAt последнего принятого serve — защита от дублей события. */
	lastServedAt: number | null;
}

export class SessionManager implements ISimEvents {
	private readonly sessions = new Map<string, PlayerSession>();
	private port: ISimPort | null = null;
	/** Доска входящих заказов. start() зовёт bootstrap.getGame(). */
	readonly incomingOrders: IncomingOrders;

	constructor(makeOrder: () => IOrder = OrderFactory.generateOrder) {
		this.incomingOrders = new IncomingOrders(makeOrder);
	}

	/** Устанавливает sync.ts: SM отвечает на события порта, порт — на запросы. */
	attachPort(port: ISimPort): void {
		this.port = port;
	}

	hasSession(username: string): boolean {
		return this.sessions.has(username);
	}

	getXp(username: string): number | undefined {
		return this.sessions.get(username)?.xp;
	}

	getOrder(username: string): IOrder | undefined {
		return this.sessions.get(username)?.order;
	}

	getLastResult(username: string): AssessmentResult | null {
		return this.sessions.get(username)?.lastResult ?? null;
	}

	/** Взять заказ из слота доски: сессия, таймер, персонаж в SIM. */
	takeOrder(username: string, slotIndex: number): TakeOrderResult {
		const existing = this.sessions.get(username);
		if (existing?.order.status === ORDER_STATUS.PENDING) {
			return { ok: false, reason: "busy" };
		}

		const taken = this.incomingOrders.takeOrder(slotIndex);
		if (!taken.ok) return taken;

		const order = taken.order;
		const session: PlayerSession = existing
			? { ...existing, order, currentItemIndex: 0, sealed: [] }
			: {
					username,
					order,
					xp: 0,
					currentItemIndex: 0,
					sealed: [],
					lastResult: null,
					timer: null,
					lastServedAt: null,
				};

		if (existing?.timer) clearTimeout(existing.timer);
		session.timer = setTimeout(
			() => this.onTimeout(username, order),
			order.timeLimit,
		);
		this.sessions.set(username, session);
		this.port?.startOrder(username, order);
		return { ok: true, order };
	}

	putIngredient(username: string, ingredientId: string): TaskAck {
		return (
			this.port?.enqueueTask(username, { kind: "put", ingredientId }) ?? {
				ok: false,
				reason: "no_character",
			}
		);
	}

	serve(username: string): TaskAck {
		return (
			this.port?.enqueueTask(username, { kind: "serve" }) ?? {
				ok: false,
				reason: "no_character",
			}
		);
	}

	bin(username: string): TaskAck {
		return (
			this.port?.enqueueTask(username, { kind: "bin" }) ?? {
				ok: false,
				reason: "no_character",
			}
		);
	}

	/**
	 * `!next`: запечатать текущее блюдо — снапшот подноса в sealed,
	 * поднос очищается, переходим к следующему блюду заказа.
	 */
	nextDish(username: string): NextDishResult {
		const session = this.sessions.get(username);
		if (!session || session.order.status !== ORDER_STATUS.PENDING) {
			return { ok: false, reason: "no_order" };
		}
		if (session.currentItemIndex >= session.order.items.length - 1) {
			return { ok: false, reason: "last_item" };
		}
		const snapshot = this.port?.getTraySnapshot(username);
		if (!snapshot || snapshot.layers.length === 0) {
			return { ok: false, reason: "tray_empty" };
		}

		session.sealed.push({
			...snapshot,
			frozenAt: Date.now(),
			layers: [...snapshot.layers],
		});
		session.currentItemIndex++;
		this.port?.clearTray(username);
		return { ok: true };
	}

	getSealedDishes(username: string): ITraySnapshot[] {
		return this.sessions.get(username)?.sealed ?? [];
	}

	getTraySnapshot(username: string): ITraySnapshot | undefined {
		return this.port?.getTraySnapshot(username);
	}

	onActionStarted(): void {
		// MVP: действие мгновенно, события старта не обрабатываем.
	}

	onActionCompleted(e: ActionCompletedEvent): void {
		if (e.action.kind !== "serve" || !e.tray) return;
		const session = this.sessions.get(e.username);
		if (!session) return;
		if (session.order.status !== ORDER_STATUS.PENDING) return;
		if (session.lastServedAt === e.tray.frozenAt) return; // дубль события

		this.finishOrder(session, e.tray);
	}

	onCharacterRemoved(_e: CharacterRemovedEvent): void {
		// MVP: персонаж живёт до despawn, дисконнекты не обрабатываем.
	}

	private finishOrder(session: PlayerSession, tray: ITraySnapshot): void {
		const order = session.order;
		this.clearTimer(session);

		order.status = ORDER_STATUS.COMPLETED;
		session.lastServedAt = tray.frozenAt;
		const sealed = session.sealed;
		const current =
			session.currentItemIndex < order.items.length - 1 ? null : tray;
		const result = OrderValidator.assessOrderDishes(sealed, current, order);
		session.lastResult = result;
		session.xp += result.xpDelta;
	}

	/** Таймаут = плохая сдача (снятие XP). Идемпотентен по ссылке на заказ. */
	onTimeout(username: string, order: IOrder): void {
		const session = this.sessions.get(username);
		if (!session || session.order !== order) return;
		if (order.status !== ORDER_STATUS.PENDING) return;

		this.clearTimer(session);
		order.status = ORDER_STATUS.EXPIRED;
		session.xp += xpForRating(0);
		this.port?.cancelOrder(username, "timeout");
	}

	private clearTimer(session: PlayerSession): void {
		if (session.timer) {
			clearTimeout(session.timer);
			session.timer = null;
		}
	}
}
