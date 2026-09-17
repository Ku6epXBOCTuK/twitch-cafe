import type { IRecipe } from "./recipe";

export const MENU_ITEM_VARIANT = {
	SIMPLE: "simple",
	COMPOSITE: "composite",
} as const;
export type MenuItemVariant =
	(typeof MENU_ITEM_VARIANT)[keyof typeof MENU_ITEM_VARIANT];

export interface IMenuItemBase {
	id: string;
	name: string;
	variant: MenuItemVariant;
}

export interface IMenuItemSimple extends IMenuItemBase {
	variant: typeof MENU_ITEM_VARIANT.SIMPLE;
}

export interface IMenuItemComposite extends IMenuItemBase {
	variant: typeof MENU_ITEM_VARIANT.COMPOSITE;
	recipe: IRecipe;
}

export type IMenuItem = IMenuItemSimple | IMenuItemComposite;
