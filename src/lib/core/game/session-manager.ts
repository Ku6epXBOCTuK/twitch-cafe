import {
	Clock,
	Cause,
	Data,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	Match,
	Queue,
	Scope,
	Semaphore,
} from "effect";
import type { IMenuItem } from "../types/menu_item";
import type { IOrder } from "../types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../types/order";
import {
	SimTaskRefusedError,
	type ISimPort,
	type SimEventQueue,
	type SimQueueClosedError,
} from "./sim-port";
import {
	ACTION_KIND,
	CANCEL_REASON,
	SIM_EVENT_TYPE,
	TASK_REFUSAL,
	type ActionCompletedEvent,
	type CancelReason,
	type CharacterRemovedEvent,
	type SimOutEvent,
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
import { GameMetrics, type GameMetricsSnapshot } from "./game-metrics";
import { safeCause, safeErrorType } from "../observability";
import { RecipeBook } from "./recipe-book";

export class BusyError extends Data.TaggedError("Busy")<{
	readonly username: string;
}> {}

export class NoOrderError extends Data.TaggedError("NoOrder")<{
	readonly username: string;
}> {}

export class NoActiveOrderError extends Data.TaggedError("NoActiveOrder")<{
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

export class ServeExpiredError extends Data.TaggedError("ServeExpired")<{
	readonly username: string;
	readonly orderId: string;
}> {}

export class ServeCancelledError extends Data.TaggedError("ServeCancelled")<{
	readonly username: string;
	readonly orderId: string;
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

export type SessionSnapshotPlayer = Omit<PlayerSession, "timeoutFiber">;

export interface SessionSnapshot {
	readonly incoming: readonly (IOrder | null)[];
	readonly sessions: readonly SessionSnapshotPlayer[];
	readonly recipe: IMenuItem | null;
}

export const SESSION_EVENT_TYPE = {
	CHANGED: "changed",
} as const;

export type SessionEventType =
	(typeof SESSION_EVENT_TYPE)[keyof typeof SESSION_EVENT_TYPE];

export interface SessionChangedEvent {
	readonly type: typeof SESSION_EVENT_TYPE.CHANGED;
	readonly revision: number;
	readonly snapshot: SessionSnapshot;
}

export type SessionChangeListener = (event: SessionChangedEvent) => void;

export const SESSION_LIFECYCLE_EVENT_TYPE = {
	ORDER_EXPIRED: "order_expired",
} as const;

export type SessionLifecycleEventType =
	(typeof SESSION_LIFECYCLE_EVENT_TYPE)[keyof typeof SESSION_LIFECYCLE_EVENT_TYPE];

export interface SessionOrderExpiredEvent {
	readonly type: typeof SESSION_LIFECYCLE_EVENT_TYPE.ORDER_EXPIRED;
	readonly username: string;
	readonly orderId: string;
	readonly xpDelta: number;
	readonly reason: CancelReason;
}

export type SessionLifecycleEvent = SessionOrderExpiredEvent;
export type SessionLifecycleListener = (event: SessionLifecycleEvent) => void;

interface PendingServe {
	readonly orderId: string;
	readonly deferred: Deferred.Deferred<
		void,
		ServeExpiredError | ServeCancelledError
	>;
}

type SessionEffect<A, E> = Effect.Effect<A, E>;
type TakeOrderEffect = SessionEffect<IOrder, BusyError | EmptySlotError>;
type NextDishEffect = SessionEffect<
	void,
	NoOrderError | LastItemError | TrayEmptyError
>;
type TaskEffect = SessionEffect<
	void,
	| NoOrderError
	| NoActiveOrderError
	| TaskRefusedError
	| SimQueueClosedError
	| ServeExpiredError
	| ServeCancelledError
>;

export class SessionManager {
	private readonly sessions = new Map<string, PlayerSession>();
	private readonly operationSemaphore = Semaphore.makeUnsafe(1);
	private readonly simEnqueueSemaphore = Semaphore.makeUnsafe(1);
	private port: ISimPort | null = null;
	private simEventQueue: SimEventQueue | null = null;
	private simEventFiber: Fiber.Fiber<unknown, unknown> | null = null;
	private readonly pendingServes = new Map<string, PendingServe>();
	private sessionScope: Scope.Closeable | null = null;
	private running = false;
	readonly incomingOrders: IncomingOrders;
	readonly recipeBook: RecipeBook;
	private readonly changeListeners = new Set<SessionChangeListener>();
	private readonly lifecycleListeners = new Set<SessionLifecycleListener>();
	private readonly metrics = new GameMetrics();
	private changeRevision = 0;

	constructor(
		makeOrder: () => IOrder = OrderFactory.generateOrder,
		private readonly config: GameConfig = DEFAULT_GAME_CONFIG,
	) {
		this.incomingOrders = new IncomingOrders(makeOrder, config, () =>
			this.notifyChange(),
		);
		this.recipeBook = new RecipeBook(() => this.notifyChange());
	}

	startEffect(): SessionEffect<void, never> {
		return Effect.gen(
			function* (this: SessionManager) {
				if (this.running) return;
				const scope = this.ensureSessionScope();
				this.startSimEventConsumer();
				yield* Scope.provide(scope)(this.incomingOrders.startEffect());
				this.running = true;
			}.bind(this),
		);
	}

	stopEffect(): Effect.Effect<void> {
		return Effect.gen(
			function* (this: SessionManager) {
				const eventFiber = this.simEventFiber;
				this.simEventFiber = null;
				if (eventFiber) yield* Fiber.interrupt(eventFiber);
				const eventQueue = this.simEventQueue;
				this.simEventQueue = null;
				for (const [username, pending] of this.pendingServes) {
					Deferred.doneUnsafe(
						pending.deferred,
						Effect.fail(
							new ServeCancelledError({
								username,
								orderId: pending.orderId,
							}),
						),
					);
				}
				this.pendingServes.clear();
				if (eventQueue) yield* Queue.shutdown(eventQueue);

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
		this.simEventQueue = port.eventQueue;
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

	getSnapshot(): SessionSnapshot {
		return {
			incoming: this.incomingOrders.getSlots(),
			sessions: [...this.sessions.values()].map((session) => ({
				username: session.username,
				order: session.order,
				xp: session.xp,
				currentItemIndex: session.currentItemIndex,
				sealed: session.sealed.map((dish) => ({
					...dish,
					layers: [...dish.layers],
				})),
				lastResult: session.lastResult,
				lastSequence: session.lastSequence,
			})),
			recipe: this.recipeBook.getCurrent(),
		};
	}

	getSnapshotEffect(): Effect.Effect<SessionSnapshot> {
		return Effect.sync(() => this.getSnapshot());
	}

	subscribeToChanges(listener: SessionChangeListener): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	subscribeToLifecycle(listener: SessionLifecycleListener): () => void {
		this.lifecycleListeners.add(listener);
		return () => this.lifecycleListeners.delete(listener);
	}

	recordCommand(): void {
		this.metrics.recordCommand();
	}

	recordFailure(): void {
		this.metrics.recordFailure();
	}

	getMetrics(queueDepth = 0): GameMetricsSnapshot {
		const timeoutCount = [...this.sessions.values()].filter(
			(session) => session.timeoutFiber !== null,
		).length;
		return this.metrics.read(
			queueDepth,
			this.sessions.size,
			this.incomingOrders.getTimerCount() + timeoutCount,
		);
	}

	private notifyChange(): void {
		const event: SessionChangedEvent = {
			type: SESSION_EVENT_TYPE.CHANGED,
			revision: ++this.changeRevision,
			snapshot: this.getSnapshot(),
		};
		for (const listener of this.changeListeners) listener(event);
	}

	private notifyLifecycle(event: SessionLifecycleEvent): void {
		for (const listener of this.lifecycleListeners) listener(event);
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
					const takenAt = yield* Clock.currentTimeMillis;
					order.takenAt = new Date(takenAt);
					order.deadline = takenAt + order.timeLimit;
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
							this.withPermit(
								this.expireOrderEffect(
									username,
									order,
									true,
									CANCEL_REASON.TIMEOUT,
								),
							),
						),
						Effect.tapDefect((defect) =>
							Effect.logError("Session order timeout failed", {
								username,
								orderId: order.id,
								cause: safeErrorType(defect),
							}),
						),
					);
					session.timeoutFiber = yield* Scope.provide(scope)(
						Effect.forkScoped(timeout, { startImmediately: false }),
					);
					this.port?.startOrder(username, order);
					this.notifyChange();
					return order;
				}.bind(this),
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
		return Effect.gen(
			function* (this: SessionManager) {
				this.startSimEventConsumer();
				if (this.pendingServes.has(username)) {
					return yield* new TaskRefusedError({
						username,
						reason: TASK_REFUSAL.BUSY,
					});
				}
				const order = this.getActiveOrder(username);
				const deferred = Deferred.makeUnsafe<
					void,
					ServeExpiredError | ServeCancelledError
				>();
				const pending: PendingServe = {
					orderId: order?.id ?? "",
					deferred,
				};
				this.pendingServes.set(username, pending);
				return yield* this.enqueueTaskEffect(username, {
					kind: ACTION_KIND.SERVE,
				}).pipe(
					Effect.flatMap(() =>
						order ? Deferred.await(deferred) : Effect.void,
					),
					Effect.ensuring(
						Effect.sync(() => {
							if (this.pendingServes.get(username) === pending) {
								this.pendingServes.delete(username);
							}
						}),
					),
				);
			}.bind(this),
		);
	}

	binEffect(username: string): TaskEffect {
		return this.enqueueTaskEffect(username, { kind: ACTION_KIND.BIN });
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
					this.notifyChange();
				}.bind(this),
			),
		);
	}

	getSealedDishes(username: string): ITraySnapshot[] {
		return this.sessions.get(username)?.sealed ?? [];
	}

	getTraySnapshot(username: string): ITraySnapshot | undefined {
		return this.port?.getTraySnapshot(username);
	}

	private enqueueTaskRawEffect(
		username: string,
		intent: TaskIntent,
	): Effect.Effect<void, SimTaskRefusedError | SimQueueClosedError> {
		const port = this.port;
		if (!port) {
			return Effect.fail(
				new SimTaskRefusedError({
					username,
					reason: TASK_REFUSAL.NO_CHARACTER,
				}),
			);
		}
		return port.enqueueTask(username, intent);
	}

	private enqueueTaskEffect(username: string, intent: TaskIntent): TaskEffect {
		const session = this.sessions.get(username);
		if (!session) return Effect.fail(new NoOrderError({ username }));
		if (session.order.status !== ORDER_STATUS.PENDING) {
			return Effect.fail(new NoActiveOrderError({ username }));
		}
		this.startSimEventConsumer();
		return this.simEnqueueSemaphore.withPermit(
			this.enqueueTaskRawEffect(username, intent).pipe(
				Effect.catchTag("SimTaskRefused", (error: SimTaskRefusedError) =>
					Effect.fail(
						new TaskRefusedError({
							username,
							reason: error.reason,
						}),
					),
				),
			),
		);
	}

	private startSimEventConsumer(): void {
		const queue = this.simEventQueue;
		if (!queue || this.simEventFiber) return;
		const scope = this.ensureSessionScope();
		const consumer = Effect.forever(
			Queue.take(queue).pipe(
				Effect.flatMap((event) =>
					this.withPermit(Effect.sync(() => this.applySimEvent(event))),
				),
			),
		);
		const fiber = Effect.runSync(
			Scope.provide(scope)(
				Effect.forkScoped(consumer, { startImmediately: true }),
			),
		);
		this.simEventFiber = fiber;
		fiber.addObserver((exit) => {
			if (this.simEventFiber === fiber) this.simEventFiber = null;
			if (
				exit._tag === "Failure" &&
				!Cause.isDone(exit.cause) &&
				!Cause.hasInterruptsOnly(exit.cause)
			) {
				Effect.runSync(
					Effect.logError("SIM event consumer failed", {
						cause: safeCause(exit.cause),
					}),
				);
			}
		});
	}

	private applySimEvent(event: SimOutEvent): void {
		const handle = Match.type<SimOutEvent>().pipe(
			Match.when({ type: SIM_EVENT_TYPE.ACTION_STARTED }, () => {}),
			Match.when({ type: SIM_EVENT_TYPE.ACTION_COMPLETED }, (completed) =>
				this.applyActionCompleted(completed),
			),
			Match.when({ type: SIM_EVENT_TYPE.CHARACTER_REMOVED }, (removed) =>
				this.applyCharacterRemoved(removed),
			),
			Match.exhaustive,
		);
		handle(event);
	}

	private applyCharacterRemoved(event: CharacterRemovedEvent): void {
		const session = this.sessions.get(event.username);
		if (!session) return;
		this.expireOrderState(session, session.order, CANCEL_REASON.LEAVE, true);
	}

	private applyActionCompleted(event: ActionCompletedEvent): void {
		if (event.action.kind !== ACTION_KIND.SERVE || !event.tray) return;
		const session = this.sessions.get(event.username);
		if (!session || event.orderId !== session.order.id) return;
		if (session.order.status !== ORDER_STATUS.PENDING) return;
		if (event.sequence <= session.lastSequence) return;
		this.finishOrder(session, event.tray, event.sequence);
		const pending = this.pendingServes.get(event.username);
		if (pending && pending.orderId === event.orderId) {
			this.pendingServes.delete(event.username);
			Deferred.doneUnsafe(pending.deferred, Effect.void);
		}
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
		this.notifyChange();
	}

	private expireOrderEffect(
		username: string,
		order: IOrder,
		fromTimeout: boolean,
		reason: CancelReason,
	): Effect.Effect<void> {
		return Effect.sync(() => {
			const session = this.sessions.get(username);
			if (!session || session.order !== order) return;
			this.expireOrderState(session, order, reason, !fromTimeout);
		});
	}

	private expireOrderState(
		session: PlayerSession,
		order: IOrder,
		reason: CancelReason,
		interruptTimeout: boolean,
	): void {
		if (session.order !== order || order.status !== ORDER_STATUS.PENDING)
			return;
		const pending = this.pendingServes.get(session.username);
		if (pending && pending.orderId === order.id) {
			this.pendingServes.delete(session.username);
			Deferred.doneUnsafe(
				pending.deferred,
				reason === CANCEL_REASON.LEAVE
					? Effect.fail(
							new ServeCancelledError({
								username: session.username,
								orderId: order.id,
							}),
						)
					: Effect.fail(
							new ServeExpiredError({
								username: session.username,
								orderId: order.id,
							}),
						),
			);
		}
		if (interruptTimeout) {
			const timeoutFiber = session.timeoutFiber;
			session.timeoutFiber = null;
			if (timeoutFiber) Effect.runSync(Fiber.interrupt(timeoutFiber));
		} else {
			session.timeoutFiber = null;
		}
		order.status = ORDER_STATUS.EXPIRED;
		const xpDelta = xpForRating(0);
		session.xp += xpDelta;
		this.port?.cancelOrder(session.username, reason);
		this.notifyChange();
		this.notifyLifecycle({
			type: SESSION_LIFECYCLE_EVENT_TYPE.ORDER_EXPIRED,
			username: session.username,
			orderId: order.id,
			xpDelta,
			reason,
		});
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
}
