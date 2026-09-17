import type { IIngredient } from "../types/ingredient";
import { INGREDIENT_CATEGORY } from "../types/ingredient";
import { MENU_ITEM_VARIANT, type IMenuItem } from "../types/menu_item";
import type { IRecipe } from "../types/recipe";
import { FILLING_ORDER } from "../types/recipe";

export const INGREDIENTS = {
	bunBottom: {
		id: "bun_bottom",
		name: "Нижняя булочка",
		category: INGREDIENT_CATEGORY.BASE,
	},
	patty: {
		id: "patty",
		name: "Котлета",
		category: INGREDIENT_CATEGORY.FILLING,
	},
	cheese: { id: "cheese", name: "Сыр", category: INGREDIENT_CATEGORY.FILLING },
	bunTop: {
		id: "bun_top",
		name: "Верхняя булочка",
		category: INGREDIENT_CATEGORY.BASE,
	},
} as const satisfies Record<string, IIngredient>;

export const BURGER_RECIPE: IRecipe = {
	id: "burger",
	name: "Бургер",
	ingredients: [
		INGREDIENTS.bunBottom,
		INGREDIENTS.patty,
		INGREDIENTS.cheese,
		INGREDIENTS.bunTop,
	],
	fillingOrder: FILLING_ORDER.ORDERED,
};

export const MENU_ITEMS: readonly IMenuItem[] = [
	{
		id: "burger",
		name: "Бургер",
		variant: MENU_ITEM_VARIANT.COMPOSITE,
		recipe: BURGER_RECIPE,
	},
	{ id: "cola", name: "Кола", variant: MENU_ITEM_VARIANT.SIMPLE },
];
