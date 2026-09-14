import type { IIngredient } from "./ingredient";

export const FILLING_ORDER = {
	ORDERED: "ordered",
	UNORDERED: "unordered",
} as const;
export type FillingOrder = (typeof FILLING_ORDER)[keyof typeof FILLING_ORDER];

export interface IRecipe {
	id: string;
	name: string;
	ingredients: IIngredient[];
	fillingOrder: FillingOrder;
}
