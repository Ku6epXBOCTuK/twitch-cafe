import type { IMenuItem } from "../types/menu_item";
import { RECIPE_REASON, type RecipeReason } from "./failure-reasons";

export type RecipeShowResult =
	{ ok: true; item: IMenuItem } | { ok: false; reason: RecipeReason };

/** Какое блюдо сейчас показано в оверлее. Пересылается в O3. */
export class RecipeBook {
	private current: IMenuItem | null = null;

	show(item: IMenuItem | null): RecipeShowResult {
		if (!item) return { ok: false, reason: RECIPE_REASON.UNKNOWN_ITEM };
		this.current = item;
		return { ok: true, item };
	}

	getCurrent(): IMenuItem | null {
		return this.current;
	}

	stop(): void {
		this.current = null;
	}
}
