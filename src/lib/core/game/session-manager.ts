import {
	Clock,
	Data,
	Duration,
	Effect,
	Exit,
	Fiber,
	Scope,
	Semaphore,
} from "effect";
import type { IOrder } from "../types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../types/order";
import type { ISimEvents, ISimPort } from "./sim-port";
import {
	ACTION_KIND,
	CANCEL_REASON,
	TASK_REFUSAL,
	type ActionCompletedEvent,
	type CharacterRemovedEvent,
	type TaskAck,
	type TaskIntent,
	type TaskRefusal,
} from "./sim-dto";
import type { ITraySnapshot } from "../types/tray";
import type { AssessmentResult } from "../services/order-validator";
import { OrderValidator } from "../services/order-validator";
import { xpForRating } from "../services/scoring";
import { OrderFactory } from "../services/order-factory";
import { EmptySlotError, IncomingOrders } from "./incoming-orders";
import { DEFAULT_GAME_CONFIG, GameConfig } from "./game-config";
import {
	NEXT_DISH_REASON,
	TAKE_ORDER_REASON,
	type NextDishReason,
	type TakeOrderReason,
} from "./failure-reasons";
import { RecipeBook } from "./recipe-book";

export type TakeOrderResult =
	{ ok: true; order: IOrder } | { ok: false; reason: TakeOrderReason };

export type NextDishResult =
	{ ok: true } | { ok: false; reason: NextDishReason };

export class BusyError extends Data.TaggedError("Busy")<{
	readonly username: string;
}> {}

export class NoOrderError extends Data.TaggedError("NoOrder")<{
	readonly username: string;
}> {}

export class LastItemError extends Data.TaggedError("LastItem")<{
	readonly username: string;
}> {}

export class TrayEmptyError extends Data.TaggedError("TrayEmpty")<{
	readonly username: string;
}> {}

export class TaskRefusedError extends Data.TaggedError("TaskRefused")<{
	readonly username: string;
	readonly reason: TaskRefusal;
}> {}

export interface PlayerSession {
	username: string;
	order: IOrder;
	xp: number;
	currentItemIndex: number;
	sealed: ITraySnapshot[];
	lastResult: AssessmentResult | null;
	timeoutFiber: Fiber.Fiber<void, never> | null;
	lastSequence: number;
}

type SessionEffect<A, E> = Effect.Effect<A, E>;
type TakeOrderEffect = SessionEffect<IOrder, BusyError | EmptySlotError>;
type NextDishEffect = SessionEffect<
	void,
	NoOrderError | LastItemError | TrayEmptyError
>;
type TaskEffect = SessionEffect<void, TaskRefusedError>;

export class SessionManager implements ISimEvents {
	private readonly sessions = new Map<string, PlayerSession>();
	private readonly operationSemaphore = Semaphore.makeUnsafe(1);
	private port: ISimPort | null = null;
	private sessionScope: Scope.Closeable | null = null;
	private running = false;
	private simEventDepth = 0;
	readonly incomingOrders: IncomingOrders;
	readonly recipeBook: RecipeBook;

	constructor(
		makeOrder: () => IOrder = OrderFactory.generateOrder,
		private readonly config: GameConfig = DEFAULT_GAME_CONFIG,
	) {
		this.incomingOrders = new IncomingOrders(makeOrder, config);
		this.recipeBook = new RecipeBook();
	}

	start(): void {
		if (this.running) return;
		Effect.runSync(this.provideLegacy(this.startEffect()));
	}

	stop(): void {
		Effect.runSync(this.stopEffect());
	}

	isRunning(): boolean {
		return this.running;
	}

	startEffect(): SessionEffect<void, never> {
		return Effect.gen(
			function* (this: SessionManager) {
				if (this.running) return;
				const scope = this.ensureSessionScope();
				yield* Scope.provide(scope)(this.incomingOrders.startEffect());
				this.running = true;
			}.bind(this),
		);
	}

	stopEffect(): Effect.Effect<void> {
		return Effect.gen(
			function* (this: SessionManager) {
				const timeoutFibers = [...this.sessions.values()]
					.map((session) => session.timeoutFiber)
					.filter((fiber): fiber is Fiber.Fiber<void, never> => fiber !== null);
				for (const session of this.sessions.values()) {
					session.timeoutFiber = null;
				}
				if (timeoutFibers.length > 0) {
					yield* Fiber.interruptAll(timeoutFibers);
				}
				yield* this.incomingOrders.stopEffect();

				const scope = this.sessionScope;
				this.sessionScope = null;
				this.running = false;
				if (scope) yield* Scope.close(scope, Exit.void);
			}.bind(this),
		);
	}

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

	getActiveOrder(username: string): IOrder | undefined {
		const order = this.sessions.get(username)?.order;
		return order?.status === ORDER_STATUS.PENDING ? order : undefined;
	}

	getLastResult(username: string): AssessmentResult | null {
		return this.sessions.get(username)?.lastResult ?? null;
	}

	getSessions(): PlayerSession[] {
		return [...this.sessions.values()].map((session) => ({ ...session }));
	}

	takeOrderEffect(username: string, slotIndex: number): TakeOrderEffect {
		return this.withPermit(
			Effect.gen(
				function* (this: SessionManager) {
					const existing = this.sessions.get(username);
					if (this.getActiveOrder(username)) {
						return yield* new BusyError({ username });
					}

					const order = yield* this.incomingOrders.takeOrderEffect(slotIndex);
					const scope = this.ensureSessionScope();
					const previousFiber = existing?.timeoutFiber ?? null;
					if (previousFiber) yield* Fiber.interrupt(previousFiber);

					const session: PlayerSession = existing
						? {
								...existing,
								order,
								currentItemIndex: 0,
								sealed: [],
								timeoutFiber: null,
								lastSequence: 0,
							}
						: {
								username,
								order,
								xp: 0,
								currentItemIndex: 0,
								sealed: [],
								lastResult: null,
								timeoutFiber: null,
								lastSequence: 0,
							};
					this.sessions.set(username, session);

					const timeout = Effect.sleep(Duration.millis(order.timeLimit)).pipe(
						Effect.andThen(
							this.withPermit(this.expireOrderEffect(username, order, true)),
						),
						Effect.tapDefect((defect) =>
							Effect.logError("Session order timeout failed", {
								username,
								orderId: order.id,
								defect,
							}),
						),
					);
					session.timeoutFiber = yield* Scope.provide(scope)(
						Effect.forkScoped(timeout, { startImmediately: false }),
					);
					this.port?.startOrder(username, order);
					return order;
				}.bind(this),
			),
		);
	}

	takeOrder(username: string, slotIndex: number): TakeOrderResult {
		return Effect.runSync(
			this.provideLegacy(
				this.takeOrderEffect(username, slotIndex).pipe(
					Effect.map((order): TakeOrderResult => ({ ok: true, order })),
					Effect.catchTag("Busy", () =>
						Effect.succeed({
							ok: false,
							reason: TAKE_ORDER_REASON.BUSY,
						} as const),
					),
					Effect.catchTag("EmptySlot", () =>
						Effect.succeed({
							ok: false,
							reason: TAKE_ORDER_REASON.EMPTY_SLOT,
						} as const),
					),
				),
			),
		);
	}

	putIngredientEffect(username: string, ingredientId: string): TaskEffect {
		return this.enqueueTaskEffect(username, {
			kind: ACTION_KIND.PUT,
			ingredientId,
		});
	}

	serveEffect(username: string): TaskEffect {
		return this.enqueueTaskEffect(username, { kind: ACTION_KIND.SERVE });
	}

	binEffect(username: string): TaskEffect {
		return this.enqueueTaskEffect(username, { kind: ACTION_KIND.BIN });
	}

	putIngredient(username: string, ingredientId: string): TaskAck {
		return this.runTaskEffect(this.putIngredientEffect(username, ingredientId));
	}

	serve(username: string): TaskAck {
		return this.runTaskEffect(this.serveEffect(username));
	}

	bin(username: string): TaskAck {
		return this.runTaskEffect(this.binEffect(username));
	}

	nextDishEffect(username: string): NextDishEffect {
		return this.withPermit(
			Effect.gen(
				function* (this: SessionManager) {
					const session = this.sessions.get(username);
					const order = this.getActiveOrder(username);
					if (!session || !order) {
						return yield* new NoOrderError({ username });
					}
					if (session.currentItemIndex >= order.items.length - 1) {
						return yield* new LastItemError({ username });
					}
					const snapshot = this.port?.getTraySnapshot(username);
					if (!snapshot || snapshot.layers.length === 0) {
						return yield* new TrayEmptyError({ username });
					}

					const frozenAt = yield* Clock.currentTimeMillis;
					order.items[session.currentItemIndex].state = ORDER_ITEM_STATE.SEALED;
					session.sealed.push({
						...snapshot,
						frozenAt,
						layers: [...snapshot.layers],
					});
					session.currentItemIndex++;
					this.port?.clearTray(username);
				}.bind(this),
			),
		);
	}

	nextDish(username: string): NextDishResult {
		return Effect.runSync(
			this.provideLegacy(
				this.nextDishEffect(username).pipe(
					Effect.map((): NextDishResult => ({ ok: true })),
					Effect.catchTag("NoOrder", () =>
						Effect.succeed({
							ok: false,
							reason: NEXT_DISH_REASON.NO_ORDER,
						} as const),
					),
					Effect.catchTag("LastItem", () =>
						Effect.succeed({
							ok: false,
							reason: NEXT_DISH_REASON.LAST_ITEM,
						} as const),
					),
					Effect.catchTag("TrayEmpty", () =>
						Effect.succeed({
							ok: false,
							reason: NEXT_DISH_REASON.TRAY_EMPTY,
						} as const),
					),
				),
			),
		);
	}

	getSealedDishes(username: string): ITraySnapshot[] {
		return this.sessions.get(username)?.sealed ?? [];
	}

	getTraySnapshot(username: string): ITraySnapshot | undefined {
		return this.port?.getTraySnapshot(username);
	}

	onActionStarted(): void {}

	onActionCompleted(event: ActionCompletedEvent): void {
		if (this.simEventDepth > 0) {
			this.applyActionCompleted(event);
			return;
		}
		Effect.runSync(
			this.withPermit(Effect.sync(() => this.applyActionCompleted(event))),
		);
	}

	onCharacterRemoved(_event: CharacterRemovedEvent): void {}

	onTimeoutEffect(username: string, order: IOrder): Effect.Effect<void> {
		return this.withPermit(this.expireOrderEffect(username, order, false));
	}

	onTimeout(username: string, order: IOrder): void {
		Effect.runSync(this.provideLegacy(this.onTimeoutEffect(username, order)));
	}

	private enqueueTaskEffect(username: string, intent: TaskIntent): TaskEffect {
		return this.withPermit(
			Effect.gen(
				function* (this: SessionManager) {
					const port = this.port;
					if (!port) {
						return yield* new TaskRefusedError({
							username,
							reason: TASK_REFUSAL.NO_CHARACTER,
						});
					}
					const ack = yield* Effect.sync(() => {
						this.simEventDepth++;
						try {
							return port.enqueueTask(username, intent);
						} finally {
							this.simEventDepth--;
						}
					});
					if (!ack.ok) {
						return yield* new TaskRefusedError({
							username,
							reason: ack.reason,
						});
					}
				}.bind(this),
			),
		);
	}

	private runTaskEffect(effect: TaskEffect): TaskAck {
		return Effect.runSync(
			this.provideLegacy(
				effect.pipe(
					Effect.map((): TaskAck => ({ ok: true })),
					Effect.catchTag("TaskRefused", (error) =>
						Effect.succeed({ ok: false, reason: error.reason }),
					),
				),
			),
		);
	}

	private applyActionCompleted(event: ActionCompletedEvent): void {
		if (event.action.kind !== ACTION_KIND.SERVE || !event.tray) return;
		const session = this.sessions.get(event.username);
		if (!session || event.orderId !== session.order.id) return;
		if (session.order.status !== ORDER_STATUS.PENDING) return;
		if (event.sequence <= session.lastSequence) return;
		this.finishOrder(session, event.tray, event.sequence);
	}

	private finishOrder(
		session: PlayerSession,
		tray: ITraySnapshot,
		sequence: number,
	): void {
		const order = session.order;
		if (order.status !== ORDER_STATUS.PENDING) return;

		const timeoutFiber = session.timeoutFiber;
		session.timeoutFiber = null;
		if (timeoutFiber) Effect.runSync(Fiber.interrupt(timeoutFiber));
		order.status = ORDER_STATUS.COMPLETED;
		session.lastSequence = sequence;
		const sealed = session.sealed;
		const current =
			session.currentItemIndex < order.items.length - 1 ? null : tray;
		const result = OrderValidator.assessOrderDishes(sealed, current, order);
		session.lastResult = result;
		session.xp += result.xpDelta;
	}

	private expireOrderEffect(
		username: string,
		order: IOrder,
		fromTimeout: boolean,
	): Effect.Effect<void> {
		return Effect.gen(
			function* (this: SessionManager) {
				const session = this.sessions.get(username);
				if (!session || session.order !== order) return;
				if (order.status !== ORDER_STATUS.PENDING) return;

				if (fromTimeout) {
					session.timeoutFiber = null;
				} else {
					const timeoutFiber = session.timeoutFiber;
					session.timeoutFiber = null;
					if (timeoutFiber) yield* Fiber.interrupt(timeoutFiber);
				}
				order.status = ORDER_STATUS.EXPIRED;
				session.xp += xpForRating(0);
				const port = this.port;
				if (port) {
					yield* Effect.sync(() =>
						port.cancelOrder(username, CANCEL_REASON.TIMEOUT),
					);
				}
			}.bind(this),
		);
	}

	private withPermit<A, E, R>(
		effect: Effect.Effect<A, E, R>,
	): Effect.Effect<A, E, R> {
		return this.operationSemaphore.withPermit(effect);
	}

	private ensureSessionScope(): Scope.Closeable {
		if (this.sessionScope && this.sessionScope.state._tag !== "Closed") {
			return this.sessionScope;
		}
		this.sessionScope = Scope.makeUnsafe("sequential");
		return this.sessionScope;
	}

	private provideLegacy<A, E>(
		effect: Effect.Effect<A, E>,
	): Effect.Effect<A, E> {
		return Effect.provideService(
			Effect.provideService(effect, GameConfig, this.config),
			Clock.Clock,
			Clock.Clock.defaultValue(),
		);
	}
}
