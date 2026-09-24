import { Match } from "effect";
import { MENU_ITEMS } from "../core/data/menu";
import { GAME_EVENT_TYPE } from "../core/game/game-event";
import {
	NEXT_DISH_REASON,
	TAKE_ORDER_REASON,
} from "../core/game/failure-reasons";
import type {
	NextDishResult,
	SessionManager,
	TakeOrderResult,
} from "../core/game/session-manager";
import {
	ACTION_KIND,
	OPERATION,
	TASK_REFUSAL,
	type ActionKind,
	type TaskAck,
	type TaskRefusal,
} from "../core/game/sim-dto";
import {
	COMMAND_KIND,
	CommandParser,
	type ParsedCommand,
} from "./command-parser";
import type { CommandSink } from "./command-sink";

function emitTaskFailure(
	sink: CommandSink,
	username: string,
	operation: ActionKind,
	ack: Extract<TaskAck, { ok: false }>,
	token: string,
): void {
	const emitRefusal = Match.type<TaskRefusal>().pipe(
		Match.when(TASK_REFUSAL.NO_CHARACTER, () => {
			sink.emit({ type: GAME_EVENT_TYPE.NOT_IN_GAME, username });
		}),
		Match.when(TASK_REFUSAL.BUSY, () => {
			sink.emit({ type: GAME_EVENT_TYPE.BUSY, username, operation });
		}),
		Match.when(TASK_REFUSAL.UNKNOWN_INGREDIENT, () => {
			sink.emit({ type: GAME_EVENT_TYPE.UNKNOWN_INGREDIENT, username, token });
		}),
		Match.when(TASK_REFUSAL.TRAY_EMPTY, () => {
			sink.emit({ type: GAME_EVENT_TYPE.TRAY_EMPTY, username, operation });
		}),
		Match.exhaustive,
	);

	emitRefusal(ack.reason);
}

type TakeFailure = Extract<TakeOrderResult, { ok: false }>;
type TakeFailureReason = TakeFailure["reason"];

function emitTakeFailure(
	sink: CommandSink,
	username: string,
	slot: number,
	failure: TakeFailure,
): void {
	const emitReason = Match.type<TakeFailureReason>().pipe(
		Match.when(TAKE_ORDER_REASON.BUSY, () => {
			sink.emit({
				type: GAME_EVENT_TYPE.BUSY,
				username,
				operation: OPERATION.TAKE,
			});
		}),
		Match.when(TAKE_ORDER_REASON.EMPTY_SLOT, () => {
			sink.emit({ type: GAME_EVENT_TYPE.EMPTY_SLOT, username, slot });
		}),
		Match.exhaustive,
	);

	emitReason(failure.reason);
}

type NextFailure = Extract<NextDishResult, { ok: false }>;
type NextFailureReason = NextFailure["reason"];

function emitNextFailure(
	sink: CommandSink,
	username: string,
	hasSession: boolean,
	failure: NextFailure,
): void {
	const emitReason = Match.type<NextFailureReason>().pipe(
		Match.when(NEXT_DISH_REASON.NO_ORDER, () => {
			sink.emit({
				type: hasSession
					? GAME_EVENT_TYPE.NO_ACTIVE_ORDER
					: GAME_EVENT_TYPE.NOT_IN_GAME,
				username,
			});
		}),
		Match.when(NEXT_DISH_REASON.LAST_ITEM, () => {
			sink.emit({ type: GAME_EVENT_TYPE.LAST_ITEM, username });
		}),
		Match.when(NEXT_DISH_REASON.TRAY_EMPTY, () => {
			sink.emit({
				type: GAME_EVENT_TYPE.TRAY_EMPTY,
				username,
				operation: OPERATION.NEXT,
			});
		}),
		Match.exhaustive,
	);

	emitReason(failure.reason);
}

/**
 * Сообщение чата → событие в sink. Не-команда обрабатывается до создания
 * каких-либо событий: sink остаётся нетронутым.
 */
export function processMessage(
	raw: string,
	username: string,
	sm: SessionManager,
	sink: CommandSink,
): null | void {
	const cmd = CommandParser.parse(raw);
	if (!cmd) return null;

	const handleCommand = Match.type<ParsedCommand>().pipe(
		Match.when({ kind: COMMAND_KIND.PUT }, (command) => {
			if (!command.ingredient) {
				sink.emit({
					type: GAME_EVENT_TYPE.UNKNOWN_INGREDIENT,
					username,
					token: command.token,
				});
				return;
			}
			const ack = sm.putIngredient(username, command.ingredient.id);
			if (!ack.ok) {
				emitTaskFailure(
					sink,
					username,
					ACTION_KIND.PUT,
					ack,
					command.ingredient.id,
				);
				return;
			}
			sink.emit({
				type: GAME_EVENT_TYPE.INGREDIENT_ADDED,
				username,
				ingredientId: command.ingredient.id,
			});
		}),
		Match.when({ kind: COMMAND_KIND.SERVE }, () => {
			const ack = sm.serve(username);
			if (!ack.ok) {
				emitTaskFailure(sink, username, ACTION_KIND.SERVE, ack, "serve");
				return;
			}
			const order = sm.getOrder(username);
			const assessment = sm.getLastResult(username);
			if (!order || !assessment) return;
			sink.emit({
				type: GAME_EVENT_TYPE.ORDER_SERVED,
				username,
				order,
				assessment,
			});
		}),
		Match.when({ kind: COMMAND_KIND.BIN }, () => {
			const ack = sm.bin(username);
			if (!ack.ok) {
				emitTaskFailure(sink, username, ACTION_KIND.BIN, ack, "bin");
				return;
			}
			sink.emit({ type: GAME_EVENT_TYPE.TRAY_CLEARED, username });
		}),
		Match.when({ kind: COMMAND_KIND.MENU }, () => {
			const order = sm.getActiveOrder(username);
			if (!order) {
				sink.emit({
					type: sm.hasSession(username)
						? GAME_EVENT_TYPE.NO_ACTIVE_ORDER
						: GAME_EVENT_TYPE.NOT_IN_GAME,
					username,
				});
				return;
			}
			const tray = sm.getTraySnapshot(username);
			sink.emit({
				type: GAME_EVENT_TYPE.MENU_STATE,
				username,
				order,
				trayLayers: tray?.layers ?? [],
			});
		}),
		Match.when({ kind: COMMAND_KIND.TAKE }, (command) => {
			if (command.slot === null) {
				sink.emit({ type: GAME_EVENT_TYPE.SLOT_REQUIRED, username });
				return;
			}
			const res = sm.takeOrder(username, command.slot - 1);
			if (!res.ok) {
				emitTakeFailure(sink, username, command.slot, res);
				return;
			}
			sink.emit({
				type: GAME_EVENT_TYPE.ORDER_TAKEN,
				username,
				order: res.order,
				slot: command.slot,
			});
		}),
		Match.when({ kind: COMMAND_KIND.RECIPE }, (command) => {
			if (!command.token) {
				sink.emit({ type: GAME_EVENT_TYPE.RECIPE_ARG_REQUIRED, username });
				return;
			}
			const entry = command.item;
			if (!entry) {
				sink.emit({
					type: GAME_EVENT_TYPE.RECIPE_UNKNOWN,
					username,
					token: command.token,
				});
				return;
			}
			const item = MENU_ITEMS.find((m) => m.id === entry.id) ?? null;
			const shown = sm.recipeBook.show(item);
			if (!shown.ok) return;
			sink.emit({
				type: GAME_EVENT_TYPE.RECIPE_SHOWN,
				username,
				item: shown.item,
			});
		}),
		Match.when({ kind: COMMAND_KIND.NEXT }, () => {
			const res = sm.nextDish(username);
			if (res.ok) {
				const order = sm.getActiveOrder(username);
				const sealed = sm.getSealedDishes(username).at(-1);
				if (!order || !sealed) return;
				sink.emit({
					type: GAME_EVENT_TYPE.DISH_SEALED,
					username,
					order,
					sealedLayers: sealed.layers,
					nextItemIndex: sm.getSealedDishes(username).length,
				});
				return;
			}
			emitNextFailure(sink, username, sm.hasSession(username), res);
		}),
		Match.exhaustive,
	);

	return handleCommand(cmd);
}
