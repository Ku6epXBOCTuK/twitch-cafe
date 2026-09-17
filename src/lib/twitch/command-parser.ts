import type { IngredientEntry } from "./ingredients";
import { resolveIngredient } from "./ingredients";

export type ParsedCommand =
	| { kind: "put"; ingredient: IngredientEntry | null; token: string }
	| { kind: "serve" }
	| { kind: "bin" }
	| { kind: "menu" };

const COMMANDS = {
	serve: ["!serve", "!submit"],
	bin: ["!bin"],
	menu: ["!menu"],
	put: ["!put", "!add", "!положи"],
} as const;

export class CommandParser {
	static parse(raw: string): ParsedCommand | null {
		const [head, ...rest] = raw.trim().split(/\s+/);
		if (!head) return null;
		const command = head.toLowerCase();

		for (const kind of ["serve", "bin", "menu"] as const) {
			if ((COMMANDS[kind] as readonly string[]).includes(command)) {
				return { kind };
			}
		}

		if ((COMMANDS.put as readonly string[]).includes(command)) {
			const token = rest.join(" ");
			return { kind: "put", ingredient: resolveIngredient(token), token };
		}

		return null;
	}
}
