import { Effect, Match } from "effect";
import { MENU_ITEMS } from "../core/data/menu";
import type { IOrder } from "../core/types/order";
import { GAME_EVENT_TYPE } from "../core/game/game-event";
import type { GameEventPayload } from "../core/game/game-event";
import {
	NEXT_DISH_REASON,
	TAKE_ORDER_REASON,
} from "../core/game/failure-reasons";
import type {
	BusyError,
	NextDishResult,
	SessionManager,
	ServeCancelledError,
	ServeExpiredError,
	TakeOrderResult,
	TaskRefusedError,
} from "../core/game/session-manager";
import { EmptySlotError } from "../core/game/incoming-orders";
import type { SimQueueClosedError } from "../core/game/sim-port";
import {
	ACTION_KIND,
	OPERATION,
	TASK_REFUSAL,
	type ActionKind,
	type TaskRefusal,
} from "../core/game/sim-dto";
import {
	COMMAND_KIND,
	CommandParser,
	type ParsedCommand,
} from "./command-parser";
import { createCommandId } from "./command-context";
import type { CommandSink } from "./command-sink";

function emitEvent(
	sink: CommandSink,
	correlationId: string,
	event: GameEventPayload,
): void {
	sink.emit({ ...event, correlationId });
}

function emitTaskFailure(
	sink: CommandSink,
	correlationId: string,
	username: string,
	operation: ActionKind,
	error: TaskRefusedError,
	token: string,
): void {
	const emitRefusal = Match.type<TaskRefusal>().pipe(
		Match.when(TASK_REFUSAL.NO_CHARACTER, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.NOT_IN_GAME,
				username,
			});
		}),
		Match.when(TASK_REFUSAL.BUSY, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.BUSY,
				username,
				operation,
			});
		}),
		Match.when(TASK_REFUSAL.UNKNOWN_INGREDIENT, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.UNKNOWN_INGREDIENT,
				username,
				token,
			});
		}),
		Match.when(TASK_REFUSAL.TRAY_EMPTY, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.TRAY_EMPTY,
				username,
				operation,
			});
		}),
		Match.exhaustive,
	);

	emitRefusal(error.reason);
}

type TakeFailureReason = Extract<TakeOrderResult, { ok: false }>["reason"];

function emitTakeFailure(
	sink: CommandSink,
	correlationId: string,
	username: string,
	slot: number,
	reason: TakeFailureReason,
): void {
	const emitReason = Match.type<TakeFailureReason>().pipe(
		Match.when(TAKE_ORDER_REASON.BUSY, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.BUSY,
				username,
				operation: OPERATION.TAKE,
			});
		}),
		Match.when(TAKE_ORDER_REASON.EMPTY_SLOT, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.EMPTY_SLOT,
				username,
				slot,
			});
		}),
		Match.exhaustive,
	);

	emitReason(reason);
}

type NextFailureReason = Extract<NextDishResult, { ok: false }>["reason"];

function emitNextFailure(
	sink: CommandSink,
	correlationId: string,
	username: string,
	hasSession: boolean,
	reason: NextFailureReason,
): void {
	const emitReason = Match.type<NextFailureReason>().pipe(
		Match.when(NEXT_DISH_REASON.NO_ORDER, () => {
			emitEvent(sink, correlationId, {
				type: hasSession
					? GAME_EVENT_TYPE.NO_ACTIVE_ORDER
					: GAME_EVENT_TYPE.NOT_IN_GAME,
				username,
			});
		}),
		Match.when(NEXT_DISH_REASON.LAST_ITEM, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.LAST_ITEM,
				username,
			});
		}),
		Match.when(NEXT_DISH_REASON.TRAY_EMPTY, () => {
			emitEvent(sink, correlationId, {
				type: GAME_EVENT_TYPE.TRAY_EMPTY,
				username,
				operation: OPERATION.NEXT,
			});
		}),
		Match.exhaustive,
	);

	emitReason(reason);
}

type TakeEffect = ReturnType<SessionManager["takeOrderEffect"]>;
type NextEffect = ReturnType<SessionManager["nextDishEffect"]>;
type TaskEffect = ReturnType<SessionManager["serveEffect"]>;
type CommandEffectError =
	SimQueueClosedError | ServeExpiredError | ServeCancelledError;

function runTake(
	effect: TakeEffect,
	onSuccess: (order: IOrder) => void,
	onFailure: (reason: TakeFailureReason) => void,
): Effect.Effect<void, never> {
	return effect.pipe(
		Effect.flatMap((order) => Effect.sync(() => onSuccess(order))),
		Effect.catchTag("Busy", (_error: BusyError) =>
			Effect.sync(() => onFailure(TAKE_ORDER_REASON.BUSY)),
		),
		Effect.catchTag("EmptySlot", (_error: EmptySlotError) =>
			Effect.sync(() => onFailure(TAKE_ORDER_REASON.EMPTY_SLOT)),
		),
	);
}

function runNext(
	effect: NextEffect,
	onSuccess: () => void,
	onFailure: (reason: NextFailureReason) => void,
): Effect.Effect<void, never> {
	return effect.pipe(
		Effect.flatMap(() => Effect.sync(onSuccess)),
		Effect.catchTag("NoOrder", (_error) =>
			Effect.sync(() => onFailure(NEXT_DISH_REASON.NO_ORDER)),
		),
		Effect.catchTag("LastItem", (_error) =>
			Effect.sync(() => onFailure(NEXT_DISH_REASON.LAST_ITEM)),
		),
		Effect.catchTag("TrayEmpty", (_error) =>
			Effect.sync(() => onFailure(NEXT_DISH_REASON.TRAY_EMPTY)),
		),
	);
}

function runTask(
	effect: TaskEffect,
	onSuccess: () => void,
	onFailure: (error: TaskRefusedError) => void,
): Effect.Effect<void, CommandEffectError> {
	return effect.pipe(
		Effect.flatMap(() => Effect.sync(onSuccess)),
		Effect.catchTag("TaskRefused", (error) =>
			Effect.sync(() => onFailure(error)),
		),
	);
}

export function processMessage(
	raw: string,
	username: string,
	sm: SessionManager,
	sink: CommandSink,
	correlationId = createCommandId(),
): Effect.Effect<void, CommandEffectError> {
	const cmd = CommandParser.parse(raw);
	if (!cmd) return Effect.void;

	const handleCommand = Match.type<ParsedCommand>().pipe(
		Match.when({ kind: COMMAND_KIND.PUT }, (command) =>
			Effect.gen(function* () {
				const ingredient = command.ingredient;
				if (!ingredient) {
					emitEvent(sink, correlationId, {
						type: GAME_EVENT_TYPE.UNKNOWN_INGREDIENT,
						username,
						token: command.token,
					});
					return;
				}
				yield* runTask(
					sm.putIngredientEffect(username, ingredient.id),
					() =>
						emitEvent(sink, correlationId, {
							type: GAME_EVENT_TYPE.INGREDIENT_ADDED,
							username,
							ingredientId: ingredient.id,
						}),
					(error) =>
						emitTaskFailure(
							sink,
							correlationId,
							username,
							ACTION_KIND.PUT,
							error,
							ingredient.id,
						),
				);
			}),
		),
		Match.when({ kind: COMMAND_KIND.SERVE }, () =>
			Effect.gen(function* () {
				yield* runTask(
					sm.serveEffect(username),
					() => {
						const order = sm.getOrder(username);
						const assessment = sm.getLastResult(username);
						if (!order || !assessment) {
							throw new Error("serve completed without an order result");
						}
						emitEvent(sink, correlationId, {
							type: GAME_EVENT_TYPE.ORDER_SERVED,
							username,
							order,
							assessment,
						});
					},
					(error) =>
						emitTaskFailure(
							sink,
							correlationId,
							username,
							ACTION_KIND.SERVE,
							error,
							"serve",
						),
				);
			}),
		),
		Match.when({ kind: COMMAND_KIND.BIN }, () =>
			Effect.gen(function* () {
				yield* runTask(
					sm.binEffect(username),
					() =>
						emitEvent(sink, correlationId, {
							type: GAME_EVENT_TYPE.TRAY_CLEARED,
							username,
						}),
					(error) =>
						emitTaskFailure(
							sink,
							correlationId,
							username,
							ACTION_KIND.BIN,
							error,
							"bin",
						),
				);
			}),
		),
		Match.when({ kind: COMMAND_KIND.MENU }, () =>
			Effect.sync(() => {
				const order = sm.getActiveOrder(username);
				if (!order) {
					emitEvent(sink, correlationId, {
						type: sm.hasSession(username)
							? GAME_EVENT_TYPE.NO_ACTIVE_ORDER
							: GAME_EVENT_TYPE.NOT_IN_GAME,
						username,
					});
					return;
				}
				const tray = sm.getTraySnapshot(username);
				emitEvent(sink, correlationId, {
					type: GAME_EVENT_TYPE.MENU_STATE,
					username,
					order,
					trayLayers: tray?.layers ?? [],
				});
			}),
		),
		Match.when({ kind: COMMAND_KIND.TAKE }, (command) =>
			Effect.gen(function* () {
				const slot = command.slot;
				if (slot === null) {
					emitEvent(sink, correlationId, {
						type: GAME_EVENT_TYPE.SLOT_REQUIRED,
						username,
					});
					return;
				}
				yield* runTake(
					sm.takeOrderEffect(username, slot - 1),
					(order) =>
						emitEvent(sink, correlationId, {
							type: GAME_EVENT_TYPE.ORDER_TAKEN,
							username,
							order,
							slot,
						}),
					(reason) =>
						emitTakeFailure(sink, correlationId, username, slot, reason),
				);
			}),
		),
		Match.when({ kind: COMMAND_KIND.RECIPE }, (command) =>
			Effect.sync(() => {
				if (!command.token) {
					emitEvent(sink, correlationId, {
						type: GAME_EVENT_TYPE.RECIPE_ARG_REQUIRED,
						username,
					});
					return;
				}
				const entry = command.item;
				if (!entry) {
					emitEvent(sink, correlationId, {
						type: GAME_EVENT_TYPE.RECIPE_UNKNOWN,
						username,
						token: command.token,
					});
					return;
				}
				const item =
					MENU_ITEMS.find((menuItem) => menuItem.id === entry.id) ?? null;
				const shown = sm.recipeBook.show(item);
				if (!shown.ok) throw new Error("recipe item resolution failed");
				emitEvent(sink, correlationId, {
					type: GAME_EVENT_TYPE.RECIPE_SHOWN,
					username,
					item: shown.item,
				});
			}),
		),
		Match.when({ kind: COMMAND_KIND.NEXT }, () =>
			Effect.gen(function* () {
				yield* runNext(
					sm.nextDishEffect(username),
					() => {
						const order = sm.getActiveOrder(username);
						const sealed = sm.getSealedDishes(username).at(-1);
						if (!order || !sealed) {
							throw new Error("next completed without a sealed dish");
						}
						emitEvent(sink, correlationId, {
							type: GAME_EVENT_TYPE.DISH_SEALED,
							username,
							order,
							sealedLayers: sealed.layers,
							nextItemIndex: sm.getSealedDishes(username).length,
						});
					},
					(reason) =>
						emitNextFailure(
							sink,
							correlationId,
							username,
							sm.hasSession(username),
							reason,
						),
				);
			}),
		),
		Match.exhaustive,
	);

	return handleCommand(cmd);
}
