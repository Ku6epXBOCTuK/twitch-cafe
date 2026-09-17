import type { SessionManager } from "../core/game/session-manager";
import { CommandParser } from "./command-parser";
import {
	replyBinAck,
	replyJoinAlready,
	replyJoinStart,
	replyMenu,
	replyNotInGame,
	replyPutAck,
	replyResult,
	replyServeAck,
	replyUnknownIngredient,
} from "./replies";

/** Сообщение чата → ответ. null — не команда, игнорируем. */
export function processMessage(
	raw: string,
	username: string,
	sm: SessionManager,
): string | null {
	const cmd = CommandParser.parse(raw);
	if (!cmd) return null;

	switch (cmd.kind) {
		case "join": {
			const order = sm.startOrder(username);
			return order ? replyJoinStart(order) : replyJoinAlready(username);
		}
		case "put": {
			if (!cmd.ingredient) return replyUnknownIngredient(username, cmd.token);
			const ack = sm.putIngredient(username, cmd.ingredient.id);
			return replyPutAck(username, ack, cmd.ingredient.id);
		}
		case "serve": {
			const ack = sm.serve(username);
			if (!ack.ok) return replyServeAck(username, ack);
			const result = sm.getLastResult(username);
			const nextOrder = sm.getOrder(username);
			if (!result || !nextOrder) return null;
			return replyResult(username, result, nextOrder);
		}
		case "bin": {
			const ack = sm.bin(username);
			return replyBinAck(username, ack);
		}
		case "menu": {
			const order = sm.getOrder(username);
			if (!order) return replyNotInGame(username);
			const tray = sm.getTraySnapshot(username);
			return replyMenu(username, order, tray?.layers ?? []);
		}
	}
}
