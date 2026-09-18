import { describe, expect, it } from "vitest";
import { CommandParser } from "./command-parser";
import { COMMAND_HINTS } from "./command-hints";

describe("COMMAND_HINTS", () => {
	it("каждая подсказка — реальная команда парсера", () => {
		expect(COMMAND_HINTS.length).toBeGreaterThan(0);
		for (const hint of COMMAND_HINTS) {
			expect(CommandParser.parse(hint.usage), hint.usage).not.toBeNull();
		}
	});

	it("у каждой подсказки есть описание", () => {
		for (const hint of COMMAND_HINTS) {
			expect(hint.description.trim().length, hint.usage).toBeGreaterThan(0);
		}
	});
});
