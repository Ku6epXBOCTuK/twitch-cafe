import type { IMenuItem } from "../types/menu_item";

/** Какое блюдо сейчас показано в оверлее. Пересылается в O3. */
export class RecipeBook {
	private current: IMenuItem | null = null;

	constructor(private readonly onChange: () => void = () => {}) {}

	show(item: IMenuItem): void {
		this.current = item;
		this.onChange();
	}

	getCurrent(): IMenuItem | null {
		return this.current;
	}

	stop(): void {
		this.current = null;
		this.onChange();
	}
}
