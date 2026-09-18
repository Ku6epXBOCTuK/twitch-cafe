import type { IngredientEntry } from "./ingredients";
import { resolveIngredient } from "./ingredients";
import type { MenuItemEntry } from "./menu-items";
import { resolveMenuItem } from "./menu-items";

export type ParsedCommand =
	| { kind: "put"; ingredient: IngredientEntry | null; token: string }
	| { kind: "serve" }
	| { kind: "bin" }
	| { kind: "menu" }
	| { kind: "take"; slot: number | null; token: string }
	| { kind: "recipe"; item: MenuItemEntry | null; token: string }
	| { kind: "next" };

const COMMANDS = {
	serve: ["!serve", "!submit", "!отдать"],
	bin: ["!bin", "!мусор"],
	menu: ["!menu", "!заказ", "!order"],
	put: ["!put", "!add", "!положи"],
	take: ["!взять", "!take"],
	recipe: ["!рецепт", "!recipe"],
	next: ["!next", "!дальше"],
} as const;

export class CommandParser {
	static parse(raw: string): ParsedCommand | null {
		const [head, ...rest] = raw.trim().split(/\s+/);
		if (!head) return null;
		const command = head.toLowerCase();

		for (const kind of ["serve", "bin", "menu", "next"] as const) {
			if ((COMMANDS[kind] as readonly string[]).includes(command)) {
				return { kind };
			}
		}

		if ((COMMANDS.put as readonly string[]).includes(command)) {
			const token = rest.join(" ");
			return { kind: "put", ingredient: resolveIngredient(token), token };
		}

		if ((COMMANDS.take as readonly string[]).includes(command)) {
			const token = rest.join(" ");
			const slot = parseSlot(token);
			return { kind: "take", slot, token };
		}

		if ((COMMANDS.recipe as readonly string[]).includes(command)) {
			const token = rest.join(" ");
			return { kind: "recipe", item: resolveMenuItem(token), token };
		}

		return null;
	}
}

/** «1»..«9» → 1..9 (1-индексация для зрителей); иначе null. */
function parseSlot(token: string): number | null {
	return /^[1-9]$/.test(token) ? Number.parseInt(token, 10) : null;
}
