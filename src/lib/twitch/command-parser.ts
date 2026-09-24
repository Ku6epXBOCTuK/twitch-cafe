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

const COMMAND_KINDS = [
	COMMAND_KIND.SERVE,
	COMMAND_KIND.BIN,
	COMMAND_KIND.MENU,
	COMMAND_KIND.NEXT,
	COMMAND_KIND.PUT,
	COMMAND_KIND.TAKE,
	COMMAND_KIND.RECIPE,
] as const;

export function resolveCommandKind(head: string): CommandKind | null {
	const command = head.toLowerCase();
	for (const kind of COMMAND_KINDS) {
		if (
			(COMMANDS[kind] as readonly string[]).some((alias) => alias === command)
		) {
			return kind;
		}
	}

	const matches = COMMAND_KINDS.filter((kind) =>
		(COMMANDS[kind] as readonly string[]).some((alias) =>
			alias.startsWith(command),
		),
	);
	return matches.length === 1 ? matches[0] : null;
}

export class CommandParser {
	static parse(raw: string): ParsedCommand | null {
		const [head, ...rest] = raw.trim().split(/\s+/);
		if (!head) return null;
		const kind = resolveCommandKind(head);
		if (!kind) return null;

		if (
			kind === COMMAND_KIND.SERVE ||
			kind === COMMAND_KIND.BIN ||
			kind === COMMAND_KIND.MENU ||
			kind === COMMAND_KIND.NEXT
		) {
			return { kind };
		}

		if (kind === COMMAND_KIND.PUT) {
			const token = rest.join(" ");
			return {
				kind: COMMAND_KIND.PUT,
				ingredient: resolveIngredient(token),
				token,
			};
		}

		if (kind === COMMAND_KIND.TAKE) {
			const token = rest.join(" ");
			const slot = parseSlot(token);
			return { kind: COMMAND_KIND.TAKE, slot, token };
		}

		if (kind === COMMAND_KIND.RECIPE) {
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
