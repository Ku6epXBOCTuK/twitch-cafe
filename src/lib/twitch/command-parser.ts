import type { IngredientEntry } from "./ingredients";
import { resolveIngredient } from "./ingredients";
import type { MenuItemEntry } from "./menu-items";
import { resolveMenuItem } from "./menu-items";

export const COMMAND_KIND = {
	PUT: "put",
	SERVE: "serve",
	BIN: "bin",
	MENU: "menu",
	TAKE: "take",
	RECIPE: "recipe",
	NEXT: "next",
} as const;

export type CommandKind = (typeof COMMAND_KIND)[keyof typeof COMMAND_KIND];

export type ParsedCommand =
	| {
			kind: typeof COMMAND_KIND.PUT;
			ingredient: IngredientEntry | null;
			token: string;
	  }
	| { kind: typeof COMMAND_KIND.SERVE }
	| { kind: typeof COMMAND_KIND.BIN }
	| { kind: typeof COMMAND_KIND.MENU }
	| { kind: typeof COMMAND_KIND.TAKE; slot: number | null; token: string }
	| {
			kind: typeof COMMAND_KIND.RECIPE;
			item: MenuItemEntry | null;
			token: string;
	  }
	| { kind: typeof COMMAND_KIND.NEXT };

const COMMANDS = {
	[COMMAND_KIND.SERVE]: ["!serve", "!submit", "!отдать"],
	[COMMAND_KIND.BIN]: ["!bin", "!мусор"],
	[COMMAND_KIND.MENU]: ["!menu", "!заказ", "!order"],
	[COMMAND_KIND.PUT]: ["!put", "!add", "!положи"],
	[COMMAND_KIND.TAKE]: ["!взять", "!take"],
	[COMMAND_KIND.RECIPE]: ["!рецепт", "!recipe"],
	[COMMAND_KIND.NEXT]: ["!next", "!дальше"],
} as const;

export class CommandParser {
	static parse(raw: string): ParsedCommand | null {
		const [head, ...rest] = raw.trim().split(/\s+/);
		if (!head) return null;
		const command = head.toLowerCase();

		for (const kind of [
			COMMAND_KIND.SERVE,
			COMMAND_KIND.BIN,
			COMMAND_KIND.MENU,
			COMMAND_KIND.NEXT,
		] as const) {
			if ((COMMANDS[kind] as readonly string[]).includes(command)) {
				return { kind };
			}
		}

		if ((COMMANDS[COMMAND_KIND.PUT] as readonly string[]).includes(command)) {
			const token = rest.join(" ");
			return {
				kind: COMMAND_KIND.PUT,
				ingredient: resolveIngredient(token),
				token,
			};
		}

		if ((COMMANDS[COMMAND_KIND.TAKE] as readonly string[]).includes(command)) {
			const token = rest.join(" ");
			const slot = parseSlot(token);
			return { kind: COMMAND_KIND.TAKE, slot, token };
		}

		if (
			(COMMANDS[COMMAND_KIND.RECIPE] as readonly string[]).includes(command)
		) {
			const token = rest.join(" ");
			return {
				kind: COMMAND_KIND.RECIPE,
				item: resolveMenuItem(token),
				token,
			};
		}

		return null;
	}
}

/** «1»..«9» → 1..9 (1-индексация для зрителей); иначе null. */
function parseSlot(token: string): number | null {
	return /^[1-9]$/.test(token) ? Number.parseInt(token, 10) : null;
}
