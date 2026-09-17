export const INGREDIENT_CATEGORY = {
	BASE: "base",
	FILLING: "filling",
} as const;
export type IngredientCategory =
	(typeof INGREDIENT_CATEGORY)[keyof typeof INGREDIENT_CATEGORY];

export interface IIngredient {
	id: string;
	name: string;
	category: IngredientCategory;
}
