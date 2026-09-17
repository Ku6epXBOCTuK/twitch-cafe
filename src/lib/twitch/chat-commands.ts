import type { SessionManager } from "../core/game/session-manager";
import { MENU_ITEMS } from "../core/data/menu";
import type { CommandSink } from "./command-sink";
import { CommandParser } from "./command-parser";
import {
	replyBinAck,
	replyMenu,
	replyNextAck,
	replyNextLastItem,
	replyNextTrayEmpty,
	replyNotInGame,
	replyPutAck,
	replyRecipeNoArg,
	replyRecipeOk,
	replyRecipeUnknown,
	replyResult,
	replyServeAck,
	replyTakeBusy,
	replyTakeEmptySlot,
	replyTakeNoSlot,
	replyTakeOk,
	replyUnknownIngredient,
} from "./replies";

/**
 * Сообщение чата → реплики в sink. Не-команда обрабатывается до создания
 * каких-либо ответов: sink остаётся нетронутым.
 */
export function processMessage(
	raw: string,
	username: string,
	sm: SessionManager,
	sink: CommandSink,
): null | void {
	const cmd = CommandParser.parse(raw);
	if (!cmd) return null;

	switch (cmd.kind) {
		case "put": {
			if (!cmd.ingredient) {
				return sink.reply(replyUnknownIngredient(username, cmd.token));
			}
			const ack = sm.putIngredient(username, cmd.ingredient.id);
			return sink.reply(replyPutAck(username, ack, cmd.ingredient.id));
		}
		case "serve": {
			const ack = sm.serve(username);
			if (!ack.ok) return sink.reply(replyServeAck(username, ack));
			const result = sm.getLastResult(username);
			if (!result) return;
			return sink.reply(replyResult(username, result));
		}
		case "bin": {
			const ack = sm.bin(username);
			return sink.reply(replyBinAck(username, ack));
		}
		case "menu": {
			const order = sm.getOrder(username);
			if (!order) return sink.reply(replyNotInGame(username));
			const tray = sm.getTraySnapshot(username);
			return sink.reply(replyMenu(username, order, tray?.layers ?? []));
		}
		case "take": {
			if (cmd.slot === null) return sink.reply(replyTakeNoSlot(username));
			const res = sm.takeOrder(username, cmd.slot - 1);
			if (!res.ok) {
				return sink.reply(
					res.reason === "busy"
						? replyTakeBusy(username)
						: replyTakeEmptySlot(username),
				);
			}
			return sink.reply(replyTakeOk(username, res.order, cmd.slot));
		}
		case "recipe": {
			if (!cmd.token) return sink.reply(replyRecipeNoArg(username));
			const entry = cmd.item;
			if (!entry) return sink.reply(replyRecipeUnknown(username, cmd.token));
			const item = MENU_ITEMS.find((m) => m.id === entry.id) ?? null;
			const shown = sm.recipeBook.show(item);
			if (!shown.ok) return;
			return sink.reply(replyRecipeOk(username, shown.item));
		}
		case "next": {
			const res = sm.nextDish(username);
			if (res.ok) return sink.reply(replyNextAck(username));
			if (res.reason === "no_order")
				return sink.reply(replyNotInGame(username));
			if (res.reason === "last_item") {
				return sink.reply(replyNextLastItem(username));
			}
			return sink.reply(replyNextTrayEmpty(username));
		}
	}
}
