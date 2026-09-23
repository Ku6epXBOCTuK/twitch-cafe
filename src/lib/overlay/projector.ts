import type {
	PlayerSession,
	SessionManager,
} from "../core/game/session-manager";
import { MENU_ITEM_VARIANT } from "../core/types/menu_item";
import type { IOrder, IOrderItem } from "../core/types/order";
import { ORDER_ITEM_STATE } from "../core/types/order";
import type {
	ExecutionOrder,
	IncomingOrder,
	OverlaySnapshot,
	PlayerOrder,
	PlayerState,
	RecipeCard,
} from "./types";

/**
 * O3: чистая проекция состояния ядра в `OverlaySnapshot`. Читает только
 * публичные методы SessionManager — ядро про оверлей не знает.
 */

/** Срок выполнения заказа, epoch ms. */
function deadlineOf(order: IOrder): number {
	return order.createdAt.getTime() + order.timeLimit;
}

/** Блюдо запечатано `!next`-ом. Текущее и будущие — `PENDING`. */
function isSealed(item: IOrderItem): boolean {
	return item.state === ORDER_ITEM_STATE.SEALED;
}

function projectIncoming(sm: SessionManager): IncomingOrder[] {
	const incoming: IncomingOrder[] = [];
	sm.incomingOrders.getSlots().forEach((order, index) => {
		if (!order) return;
		incoming.push({
			// Слоты 1-based: номер для `!взять N` (см. `command-parser`).
			slot: index + 1,
			id: order.id,
			dishes: order.items.map((item) => item.item.name),
			strictness: order.customer.strictness,
			deadline: deadlineOf(order),
		});
	});
	return incoming;
}

/** Монитор исполнения: только заказы на мониторах (status === PENDING). */
function projectExecution(
	sm: SessionManager,
	sessions: PlayerSession[],
): ExecutionOrder[] {
	const execution: ExecutionOrder[] = [];
	for (const session of sessions) {
		const order = sm.getActiveOrder(session.username);
		if (!order) continue;
		execution.push({
			id: order.id,
			performer: session.username,
			dishes: order.items.map((item) => ({
				name: item.item.name,
				done: isSealed(item),
			})),
			deadline: deadlineOf(order),
		});
	}
	return execution;
}

function playerOrder(
	sm: SessionManager,
	session: PlayerSession,
): PlayerOrder | null {
	const order = sm.getActiveOrder(session.username);
	if (!order) return null;
	return {
		dishes: order.items.map((item) => ({
			kind: item.item.kind,
			done: isSealed(item),
		})),
	};
}

/** Игрок остаётся в списке и без заказа (после serve/timeout). */
function projectPlayers(
	sm: SessionManager,
	sessions: PlayerSession[],
): PlayerState[] {
	return sessions.map((session) => ({
		username: session.username,
		x: 0,
		y: 0,
		order: playerOrder(sm, session),
	}));
}

function projectRecipe(sm: SessionManager): RecipeCard | null {
	const item = sm.recipeBook.getCurrent();
	if (!item) return null;
	const ingredients =
		item.variant === MENU_ITEM_VARIANT.COMPOSITE
			? item.recipe.ingredients.map((ingredient) => ingredient.name)
			: [];
	return { id: item.id, name: item.name, ingredients };
}

export function project(sm: SessionManager): OverlaySnapshot {
	const sessions = sm.getSessions();
	return {
		incoming: projectIncoming(sm),
		execution: projectExecution(sm, sessions),
		players: projectPlayers(sm, sessions),
		recipe: projectRecipe(sm),
	};
}
