import { Match } from "effect";
import type { IOrder, IOrderItem } from "../core/types/order";
import type { IMenuItem, IMenuItemComposite } from "../core/types/menu_item";
import {
	BUSY_OPERATION,
	GAME_EVENT_TYPE,
	TRAY_EMPTY_OPERATION,
	type BusyOperation,
	type GameEvent,
	type TrayEmptyOperation,
} from "../core/game/game-event";
import type { AssessmentResult } from "../core/services/order-validator";
import { nameForId } from "./ingredients";

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

export function replyOrderExpired(username: string, xpDelta: number): string {
	return `${username}: заказ истёк, ${xpDelta} XP.`;
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

function renderBusy(username: string, operation: BusyOperation): string {
	return Match.type<BusyOperation>().pipe(
		Match.when(BUSY_OPERATION.TAKE, () => replyTakeBusy(username)),
		Match.when(BUSY_OPERATION.PUT, () => replyBusy(username)),
		Match.when(BUSY_OPERATION.SERVE, () => replyBusy(username)),
		Match.when(BUSY_OPERATION.BIN, () => replyBusy(username)),
		Match.exhaustive,
	)(operation);
}

function renderTrayEmpty(
	username: string,
	operation: TrayEmptyOperation,
): string {
	return Match.type<TrayEmptyOperation>().pipe(
		Match.when(
			TRAY_EMPTY_OPERATION.SERVE,
			() => `${username}, поднос пуст — сначала !put ингредиенты.`,
		),
		Match.when(TRAY_EMPTY_OPERATION.NEXT, () => replyNextTrayEmpty(username)),
		Match.when(TRAY_EMPTY_OPERATION.PUT, () => `${username}, поднос пуст.`),
		Match.when(TRAY_EMPTY_OPERATION.BIN, () => `${username}, поднос пуст.`),
		Match.exhaustive,
	)(operation);
}

const renderGameEvent = Match.type<GameEvent>().pipe(
	Match.when({ type: GAME_EVENT_TYPE.NOT_IN_GAME }, (event) =>
		replyNotInGame(event.username),
	),
	Match.when({ type: GAME_EVENT_TYPE.NO_ACTIVE_ORDER }, (event) =>
		replyNoActiveOrder(event.username),
	),
	Match.when({ type: GAME_EVENT_TYPE.BUSY }, (event) =>
		renderBusy(event.username, event.operation),
	),
	Match.when({ type: GAME_EVENT_TYPE.UNKNOWN_INGREDIENT }, (event) =>
		replyUnknownIngredient(event.username, event.token),
	),
	Match.when(
		{ type: GAME_EVENT_TYPE.INGREDIENT_ADDED },
		(event) =>
			`${event.username} положил: ${nameForId(event.ingredientId) ?? event.ingredientId}.`,
	),
	Match.when({ type: GAME_EVENT_TYPE.TRAY_EMPTY }, (event) =>
		renderTrayEmpty(event.username, event.operation),
	),
	Match.when({ type: GAME_EVENT_TYPE.ORDER_TAKEN }, (event) =>
		replyTakeOk(event.username, event.order, event.slot),
	),
	Match.when({ type: GAME_EVENT_TYPE.EMPTY_SLOT }, (event) =>
		replyTakeEmptySlot(event.username),
	),
	Match.when({ type: GAME_EVENT_TYPE.SLOT_REQUIRED }, (event) =>
		replyTakeNoSlot(event.username),
	),
	Match.when({ type: GAME_EVENT_TYPE.MENU_STATE }, (event) =>
		replyMenu(event.username, event.order, [...event.trayLayers]),
	),
	Match.when({ type: GAME_EVENT_TYPE.DISH_SEALED }, (event) =>
		replyNextAck(event.username),
	),
	Match.when({ type: GAME_EVENT_TYPE.LAST_ITEM }, (event) =>
		replyNextLastItem(event.username),
	),
	Match.when({ type: GAME_EVENT_TYPE.ORDER_SERVED }, (event) =>
		replyResult(event.username, event.assessment),
	),
	Match.when(
		{ type: GAME_EVENT_TYPE.TRAY_CLEARED },
		(event) => `${event.username} сбросил поднос в мусорку.`,
	),
	Match.when({ type: GAME_EVENT_TYPE.RECIPE_ARG_REQUIRED }, (event) =>
		replyRecipeNoArg(event.username),
	),
	Match.when({ type: GAME_EVENT_TYPE.RECIPE_SHOWN }, (event) =>
		replyRecipeOk(event.username, event.item),
	),
	Match.when({ type: GAME_EVENT_TYPE.RECIPE_UNKNOWN }, (event) =>
		replyRecipeUnknown(event.username, event.token),
	),
	Match.when({ type: GAME_EVENT_TYPE.ORDER_EXPIRED }, (event) => {
		const xp =
			event.xpDelta >= 0 ? `+${event.xpDelta} XP` : `${event.xpDelta} XP`;
		return `${event.username}: заказ истёк. ${xp}.`;
	}),
	Match.exhaustive,
);

export function renderEvent(event: GameEvent): string {
	return renderGameEvent(event);
}
