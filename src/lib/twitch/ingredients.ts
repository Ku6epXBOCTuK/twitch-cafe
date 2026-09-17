import { MENU_ITEMS } from "../core/data/menu";
import type { IMenuItem } from "../core/types/menu_item";

export interface IngredientEntry {
	id: string;
	name: string;
}

/** Из меню: ингредиенты рецептов + простые предметы (напитки). */
export const INGREDIENT_ENTRIES: readonly IngredientEntry[] =
	MENU_ITEMS.flatMap((item: IMenuItem) => {
		if ("recipe" in item) {
			return item.recipe.ingredients.map((ing) => ({
				id: ing.id,
				name: ing.name,
			}));
		}
		return [{ id: item.id, name: item.name }];
	});

const byId = new Map(INGREDIENT_ENTRIES.map((e) => [e.id, e]));
const byName = new Map(
	INGREDIENT_ENTRIES.map((e) => [e.name.toLowerCase(), e]),
);

/** id или кусок названия («сыр», «верхняя») → запись каталога. */
export function resolveIngredient(token: string): IngredientEntry | null {
	const lower = token.trim().toLowerCase();
	if (byId.has(lower)) return byId.get(lower)!;
	const byFullName = byName.get(lower);
	if (byFullName) return byFullName;
	return (
		INGREDIENT_ENTRIES.find((e) => e.name.toLowerCase().includes(lower)) ?? null
	);
}

export function nameForId(id: string): string | null {
	return byId.get(id)?.name ?? null;
}
