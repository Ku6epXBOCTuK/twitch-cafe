import {
	Clock,
	Data,
	Duration,
	Effect,
	Exit,
	Fiber,
	Result,
	Schedule,
	Scope,
} from "effect";
import { ORDER_STATUS, type IOrder } from "../types/order";
import { OrderFactory } from "../services/order-factory";
import { DEFAULT_GAME_CONFIG, GameConfig } from "./game-config";
import { TAKE_ORDER_REASON } from "./failure-reasons";

export type TakeOrderResult =
	| { ok: true; order: IOrder }
	| { ok: false; reason: typeof TAKE_ORDER_REASON.EMPTY_SLOT };

export class EmptySlotError extends Data.TaggedError("EmptySlot")<{
	readonly slot: number;
}> {}

type TimedEffect<A> = Effect.Effect<A, never, Scope.Scope>;

export class IncomingOrders {
	private readonly slots: (IOrder | null)[];
	private readonly burnFibers = new Map<number, Fiber.Fiber<void, never>>();
	private loopFiber: Fiber.Fiber<void, never> | null = null;
	private legacyScope: Scope.Closeable | null = null;
	private running = false;

	constructor(
		private readonly makeOrder: () => IOrder = OrderFactory.generateOrder,
		private readonly config: GameConfig = DEFAULT_GAME_CONFIG,
		private readonly onChange: () => void = () => {},
	) {
		this.slots = Array.from({ length: config.SLOT_COUNT }, () => null);
	}

	start(): void {
		if (this.loopFiber) return;
		this.runWithLegacyServices(this.startEffect());
	}

	stop(): void {
		Effect.runSync(this.stopEffect());
		const scope = this.legacyScope;
		this.legacyScope = null;
		if (scope) Effect.runSync(Scope.close(scope, Exit.void));
	}

	isRunning(): boolean {
		return this.running;
	}

	startEffect(): TimedEffect<void> {
		return Effect.gen(
			function* (this: IncomingOrders) {
				if (this.loopFiber) return;
				const config = yield* GameConfig;
				const interval = Duration.millis(config.SPAWN_INTERVAL_MS);
				const loop = Effect.sleep(interval).pipe(
					Effect.andThen(
						Effect.asVoid(
							Effect.repeat(this.spawnEffect(), Schedule.spaced(interval)),
						),
					),
				);
				const fiber = yield* Effect.forkScoped(loop, {
					startImmediately: true,
				});
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						if (this.loopFiber === fiber) {
							this.loopFiber = null;
							this.running = false;
							this.burnFibers.clear();
						}
					}),
				);
				this.loopFiber = fiber;
				this.running = true;
			}.bind(this),
		);
	}

	stopEffect(): Effect.Effect<void> {
		return Effect.gen(
			function* (this: IncomingOrders) {
				const loop = this.loopFiber;
				this.loopFiber = null;
				this.running = false;
				if (loop) yield* Fiber.interrupt(loop);

				const burnFibers = [...this.burnFibers.values()];
				this.burnFibers.clear();
				if (burnFibers.length > 0) yield* Fiber.interruptAll(burnFibers);
			}.bind(this),
		);
	}

	getSlots(): readonly (IOrder | null)[] {
		return [...this.slots];
	}

	takeOrderEffect(slotIndex: number): Effect.Effect<IOrder, EmptySlotError> {
		return Effect.gen(
			function* (this: IncomingOrders) {
				const order = this.slots[slotIndex];
				if (slotIndex < 0 || slotIndex >= this.slots.length || !order) {
					return yield* new EmptySlotError({ slot: slotIndex });
				}

				this.slots[slotIndex] = null;
				const fiber = this.burnFibers.get(slotIndex);
				if (fiber) {
					yield* Fiber.interrupt(fiber);
					if (this.burnFibers.get(slotIndex) === fiber) {
						this.burnFibers.delete(slotIndex);
					}
				}
				return order;
			}.bind(this),
		);
	}

	takeOrder(slotIndex: number): TakeOrderResult {
		const result = Effect.runSync(
			Effect.result(this.takeOrderEffect(slotIndex)),
		);
		if (Result.isSuccess(result)) return { ok: true, order: result.success };
		return { ok: false, reason: TAKE_ORDER_REASON.EMPTY_SLOT };
	}

	spawnEffect(): TimedEffect<void> {
		return Effect.gen(
			function* (this: IncomingOrders) {
				const config = yield* GameConfig;
				const index = this.slots.findIndex((slot) => slot === null);
				if (index === -1) return;

				const order = this.makeOrder();
				this.slots[index] = order;
				const burn = Effect.sleep(
					Duration.millis(config.SLOT_LIFETIME_MS),
				).pipe(Effect.andThen(Effect.sync(() => this.burn(order.id))));
				const fiber = yield* Effect.forkScoped(burn, {
					startImmediately: false,
				});
				this.burnFibers.set(index, fiber);
				this.onChange();
			}.bind(this),
		);
	}

	spawn(): void {
		this.runWithLegacyServices(this.spawnEffect());
	}

	private burn(orderId: string): void {
		const index = this.slots.findIndex((slot) => slot?.id === orderId);
		const order = index === -1 ? null : this.slots[index];
		if (!order || order.id !== orderId) return;

		this.burnFibers.delete(index);
		order.status = ORDER_STATUS.EXPIRED;
		this.slots[index] = null;
		this.onChange();
	}

	private ensureLegacyScope(): Scope.Closeable {
		if (this.legacyScope) return this.legacyScope;
		this.legacyScope = Scope.makeUnsafe("sequential");
		return this.legacyScope;
	}

	private runWithLegacyServices<A>(effect: TimedEffect<A>): A {
		const scope = this.ensureLegacyScope();
		return Effect.runSync(
			Scope.provide(scope)(
				Effect.provideService(
					Effect.provideService(effect, GameConfig, this.config),
					Clock.Clock,
					Clock.Clock.defaultValue(),
				),
			),
		);
	}
}
