import type { IMenuItem } from "../types/menu_item";

export type RecipeShowResult =
	{ ok: true; item: IMenuItem } | { ok: false; reason: "unknown_item" };

/** Какое блюдо сейчас показано в оверлее. Пересылается в O3. */
export class RecipeBook {
	private current: IMenuItem | null = null;

	show(item: IMenuItem | null): RecipeShowResult {
		if (!item) return { ok: false, reason: "unknown_item" };
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
