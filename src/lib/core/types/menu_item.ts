import type { IRecipe } from "./recipe";

export const MENU_ITEM_VARIANT = {
	SIMPLE: "simple",
	COMPOSITE: "composite",
} as const;
export type MenuItemVariant =
	(typeof MENU_ITEM_VARIANT)[keyof typeof MENU_ITEM_VARIANT];

export interface IMenuItem {
	id: string;
	name: string;
	variant: MenuItemVariant;
}

export interface IMenuItemSimple extends IMenuItem {
	variant: typeof MENU_ITEM_VARIANT.SIMPLE;
}

export interface IMenuItemComposite extends IMenuItem {
	variant: typeof MENU_ITEM_VARIANT.COMPOSITE;
	recipe: IRecipe;
}
