import { Match } from "effect";
import { MENU_ITEMS } from "../core/data/menu";
import type { SessionManager } from "../core/game/session-manager";
import type { TaskAck } from "../core/game/sim-dto";
import { CommandParser, type ParsedCommand } from "./command-parser";
import type { CommandSink } from "./command-sink";

type TaskOperation = "put" | "serve" | "bin";

function emitTaskFailure(
	sink: CommandSink,
	username: string,
	operation: TaskOperation,
	ack: Extract<TaskAck, { ok: false }>,
	token: string,
): void {
	if (ack.reason === "no_character") {
		sink.emit({ type: "not_in_game", username });
		return;
	}
	if (ack.reason === "busy") {
		sink.emit({ type: "busy", username, operation });
		return;
	}
	if (ack.reason === "unknown_ingredient") {
		sink.emit({ type: "unknown_ingredient", username, token });
		return;
	}
	sink.emit({ type: "tray_empty", username, operation });
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
		Match.when({ kind: "put" }, (command) => {
			if (!command.ingredient) {
				sink.emit({
					type: "unknown_ingredient",
					username,
					token: command.token,
				});
				return;
			}
			const ack = sm.putIngredient(username, command.ingredient.id);
			if (!ack.ok) {
				emitTaskFailure(sink, username, "put", ack, command.ingredient.id);
				return;
			}
			sink.emit({
				type: "ingredient_added",
				username,
				ingredientId: command.ingredient.id,
			});
		}),
		Match.when({ kind: "serve" }, () => {
			const ack = sm.serve(username);
			if (!ack.ok) {
				emitTaskFailure(sink, username, "serve", ack, "serve");
				return;
			}
			const order = sm.getOrder(username);
			const assessment = sm.getLastResult(username);
			if (!order || !assessment) return;
			sink.emit({ type: "order_served", username, order, assessment });
		}),
		Match.when({ kind: "bin" }, () => {
			const ack = sm.bin(username);
			if (!ack.ok) {
				emitTaskFailure(sink, username, "bin", ack, "bin");
				return;
			}
			sink.emit({ type: "tray_cleared", username });
		}),
		Match.when({ kind: "menu" }, () => {
			const order = sm.getActiveOrder(username);
			if (!order) {
				sink.emit({
					type: sm.hasSession(username) ? "no_active_order" : "not_in_game",
					username,
				});
				return;
			}
			const tray = sm.getTraySnapshot(username);
			sink.emit({
				type: "menu_state",
				username,
				order,
				trayLayers: tray?.layers ?? [],
			});
		}),
		Match.when({ kind: "take" }, (command) => {
			if (command.slot === null) {
				sink.emit({ type: "slot_required", username });
				return;
			}
			const res = sm.takeOrder(username, command.slot - 1);
			if (!res.ok) {
				sink.emit(
					res.reason === "busy"
						? { type: "busy", username, operation: "take" as const }
						: { type: "empty_slot", username, slot: command.slot },
				);
				return;
			}
			sink.emit({
				type: "order_taken",
				username,
				order: res.order,
				slot: command.slot,
			});
		}),
		Match.when({ kind: "recipe" }, (command) => {
			if (!command.token) {
				sink.emit({ type: "recipe_arg_required", username });
				return;
			}
			const entry = command.item;
			if (!entry) {
				sink.emit({ type: "recipe_unknown", username, token: command.token });
				return;
			}
			const item = MENU_ITEMS.find((m) => m.id === entry.id) ?? null;
			const shown = sm.recipeBook.show(item);
			if (!shown.ok) return;
			sink.emit({ type: "recipe_shown", username, item: shown.item });
		}),
		Match.when({ kind: "next" }, () => {
			const res = sm.nextDish(username);
			if (res.ok) {
				const order = sm.getActiveOrder(username);
				const sealed = sm.getSealedDishes(username).at(-1);
				if (!order || !sealed) return;
				sink.emit({
					type: "dish_sealed",
					username,
					order,
					sealedLayers: sealed.layers,
					nextItemIndex: sm.getSealedDishes(username).length,
				});
				return;
			}
			if (res.reason === "no_order") {
				sink.emit({
					type: sm.hasSession(username) ? "no_active_order" : "not_in_game",
					username,
				});
				return;
			}
			if (res.reason === "last_item") {
				sink.emit({ type: "last_item", username });
				return;
			}
			sink.emit({ type: "tray_empty", username, operation: "next" });
		}),
		Match.exhaustive,
	);

	return handleCommand(cmd);
}
