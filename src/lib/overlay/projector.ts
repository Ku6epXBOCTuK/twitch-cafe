import type {
	SessionSnapshot,
	SessionSnapshotPlayer,
} from "../core/game/session-manager";
import { MENU_ITEM_VARIANT } from "../core/types/menu_item";
import type { IMenuItem, IMenuItemComposite } from "../core/types/menu_item";
import type { IOrder, IOrderItem } from "../core/types/order";
import { ORDER_ITEM_STATE, ORDER_STATUS } from "../core/types/order";
import type {
	ExecutionOrder,
	IncomingOrder,
	OverlaySnapshot,
	PlayerOrder,
	PlayerState,
	RecipeCard,
} from "./types";

function deadlineOf(order: IOrder): number {
	return order.createdAt.getTime() + order.timeLimit;
}

function isSealed(item: IOrderItem): boolean {
	return item.state === ORDER_ITEM_STATE.SEALED;
}

function activeOrder(session: SessionSnapshotPlayer): IOrder | undefined {
	return session.order.status === ORDER_STATUS.PENDING
		? session.order
		: undefined;
}

function projectIncoming(
	incoming: SessionSnapshot["incoming"],
): IncomingOrder[] {
	const result: IncomingOrder[] = [];
	incoming.forEach((order, index) => {
		if (!order) return;
		result.push({
			slot: index + 1,
			id: order.id,
			dishes: order.items.map((entry) => entry.item.name),
			strictness: order.customer.strictness,
			deadline: deadlineOf(order),
		});
	});
	return result;
}

function projectExecution(
	sessions: readonly SessionSnapshotPlayer[],
): ExecutionOrder[] {
	const execution: ExecutionOrder[] = [];
	for (const session of sessions) {
		const order = activeOrder(session);
		if (!order) continue;
		execution.push({
			id: order.id,
			performer: session.username,
			dishes: order.items.map((entry) => ({
				name: entry.item.name,
				done: isSealed(entry),
			})),
			deadline: deadlineOf(order),
		});
	}
	return execution;
}

function playerOrder(session: SessionSnapshotPlayer): PlayerOrder | null {
	const order = activeOrder(session);
	if (!order) return null;
	return {
		dishes: order.items.map((entry) => ({
			kind: entry.item.kind,
			done: isSealed(entry),
		})),
	};
}

function projectPlayers(
	sessions: readonly SessionSnapshotPlayer[],
): PlayerState[] {
	return sessions.map((session) => ({
		username: session.username,
		x: 0,
		y: 0,
		order: playerOrder(session),
	}));
}

function projectRecipe(recipe: IMenuItem | null): RecipeCard | null {
	if (!recipe) return null;
	const ingredients =
		recipe.variant === MENU_ITEM_VARIANT.COMPOSITE
			? (recipe as IMenuItemComposite).recipe.ingredients.map(
					(ingredient) => ingredient.name,
				)
			: [];
	return { id: recipe.id, name: recipe.name, ingredients };
}

export function projectSnapshot(snapshot: SessionSnapshot): OverlaySnapshot {
	return {
		incoming: projectIncoming(snapshot.incoming),
		execution: projectExecution(snapshot.sessions),
		players: projectPlayers(snapshot.sessions),
		recipe: projectRecipe(snapshot.recipe),
	};
}
