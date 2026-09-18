import type { MenuItemKind } from "../core/types/menu_item";

export interface IncomingOrder {
	/** Номер слота доски входящих, 1-based — тот же, что в `!взять N`. */
	slot: number;
	id: string;
	dishes: string[];
	strictness: number;
	/** срок выполнения, epoch ms */
	deadline: number;
}

export interface ExecutionDish {
	name: string;
	done: boolean;
}

export interface ExecutionOrder {
	id: string;
	performer: string;
	dishes: ExecutionDish[];
	/** срок выполнения, epoch ms */
	deadline: number;
}

/** Иконка блюда над аватаркой игрока (рендер — O4+). */
export interface PlayerDish {
	kind: MenuItemKind;
	done: boolean;
}

/** Заказ игрока по блюдам: длина = сколько всего, `done` = запечатано. */
export interface PlayerOrder {
	dishes: PlayerDish[];
}

export interface PlayerState {
	username: string;
	/** Координаты — заглушка до O4 (SIM). */
	x: number;
	y: number;
	/** `null`, если активного заказа нет; сессия при этом остаётся. */
	order: PlayerOrder | null;
}

export interface RecipeCard {
	id: string;
	name: string;
	ingredients: string[];
}

export interface OverlaySnapshot {
	incoming: IncomingOrder[];
	execution: ExecutionOrder[];
	players: PlayerState[];
	recipe: RecipeCard | null;
}
