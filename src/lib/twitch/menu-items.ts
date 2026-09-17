import { MENU_ITEMS } from "../core/data/menu";
import type { IMenuItem } from "../core/types/menu_item";

export interface MenuItemEntry {
	id: string;
	name: string;
}

export const MENU_ITEM_ENTRIES: readonly MenuItemEntry[] = MENU_ITEMS.map(
	(item: IMenuItem) => ({ id: item.id, name: item.name }),
);

const byId = new Map(MENU_ITEM_ENTRIES.map((e) => [e.id, e]));
const byName = new Map(MENU_ITEM_ENTRIES.map((e) => [e.name.toLowerCase(), e]));

/** id или кусок названия («бургер», «пепп») → пункт меню. */
export function resolveMenuItem(token: string): MenuItemEntry | null {
	const lower = token.trim().toLowerCase();
	if (!lower) return null;
	if (byId.has(lower)) return byId.get(lower)!;
	const byFullName = byName.get(lower);
	if (byFullName) return byFullName;
	return (
		MENU_ITEM_ENTRIES.find((e) => e.name.toLowerCase().includes(lower)) ?? null
	);
}
