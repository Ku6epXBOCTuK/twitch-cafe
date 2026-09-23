import type { IOrder, IOrderItem } from "../core/types/order";
import type { IMenuItem, IMenuItemComposite } from "../core/types/menu_item";
import type { TaskAck } from "../core/game/sim-dto";
import type { AssessmentResult } from "../core/services/order-validator";
import { nameForId } from "./ingredients";

// TODO: refactor to use events, and emit to receiver interface (bot, sse, etc)

const VERDICT_TEXT: Record<AssessmentResult["verdict"], string> = {
	perfect: "Идеально!",
	good: "Хорошо!",
	ok: "Неплохо.",
	bad: "Плохо…",
	awful: "Ужасно!",
};

export function itemLabel(item: IMenuItem): string {
	if ("recipe" in item) {
		const composite = item as IMenuItemComposite;
		const parts = composite.recipe.ingredients.map((i) => i.name);
		return `${item.name} (${parts.join(", ")})`;
	}
	return item.name;
}

export function orderItemLabel(entry: IOrderItem): string {
	return itemLabel(entry.item);
}

export function orderDescription(order: IOrder): string {
	return order.items.map(orderItemLabel).join(", ");
}

export function replyNotInGame(username: string): string {
	return `${username}, ты не в игре.`;
}

export function replyNoActiveOrder(username: string): string {
	return `${username}, у тебя нет активного заказа.`;
}

export function replyUnknownIngredient(
	username: string,
	token: string,
): string {
	return `${username}, нет такого ингредиента: “${token}”.`;
}

export function replyBusy(username: string): string {
	return `${username}, персонаж ещё идёт — подожди.`;
}

export function replyPutAck(
	username: string,
	ack: TaskAck,
	ingredientId: string,
): string {
	if (ack.ok)
		return `${username} положил: ${nameForId(ingredientId) ?? ingredientId}.`;
	if (ack.reason === "no_character") return replyNotInGame(username);
	if (ack.reason === "busy") return replyBusy(username);
	return replyUnknownIngredient(username, ingredientId);
}

export function replyServeAck(
	username: string,
	ack: Extract<TaskAck, { ok: false }>,
): string {
	if (ack.reason === "tray_empty")
		return `${username}, поднос пуст — сначала !put ингредиенты.`;
	if (ack.reason === "no_character") return replyNotInGame(username);
	return replyBusy(username);
}

export function replyBinAck(username: string, ack: TaskAck): string {
	if (ack.ok) return `${username} сбросил поднос в мусорку.`;
	if (ack.reason === "no_character") return replyNotInGame(username);
	return replyBusy(username);
}

export function replyResult(
	username: string,
	result: AssessmentResult,
): string {
	const xp =
		result.xpDelta >= 0 ? `+${result.xpDelta} XP` : `${result.xpDelta} XP`;
	const complains: string[] = [];
	if (result.missing.length > 0) {
		complains.push(
			`не хватает: ${result.missing.map((id) => nameForId(id) ?? id).join(", ")}`,
		);
	}
	if (result.extra.length > 0) {
		complains.push(
			`лишнее: ${result.extra.map((id) => nameForId(id) ?? id).join(", ")}`,
		);
	}
	complains.push(...result.orderIssues);
	const notes = complains.length > 0 ? ` (${complains.join("; ")})` : "";
	return `${username}: ${VERDICT_TEXT[result.verdict]} ${xp}.${notes}`;
}

export function replyMenu(
	username: string,
	order: IOrder,
	trayLayers: string[],
): string {
	const tray =
		trayLayers.length > 0
			? trayLayers.map((id) => nameForId(id) ?? id).join(" → ")
			: "пуст";
	return `${username}: заказ — ${orderDescription(order)}. Поднос: ${tray}.`;
}

export function replyTakeNoSlot(username: string): string {
	return `${username}, напиши номер слота 1–3: !взять 1.`;
}

export function replyTakeOk(
	username: string,
	order: IOrder,
	slotNumber: number,
): string {
	return `${username} взял заказ №${slotNumber}: ${orderDescription(order)}.`;
}

export function replyTakeBusy(username: string): string {
	return `${username}, у тебя уже есть заказ.`;
}

export function replyTakeEmptySlot(username: string): string {
	return `${username}, этот слот пуст.`;
}

export function replyRecipeNoArg(username: string): string {
	return `${username}, напиши название блюда: !рецепт бургер.`;
}

export function replyRecipeUnknown(username: string, token: string): string {
	return `${username}, нет такого блюда: “${token}”.`;
}

export function replyRecipeOk(username: string, item: IMenuItem): string {
	return `${username}, показываю рецепт: ${itemLabel(item)}.`;
}

export function replyNextAck(username: string): string {
	return `${username} запечатал блюдо, поднос чистый.`;
}

export function replyNextLastItem(username: string): string {
	return `${username}, это последнее блюдо заказа — отдавай через !serve.`;
}

export function replyNextTrayEmpty(username: string): string {
	return `${username}, поднос пуст — нечего запечатывать.`;
}
