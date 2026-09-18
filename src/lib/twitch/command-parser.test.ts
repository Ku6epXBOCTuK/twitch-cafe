import { describe, expect, it } from "vitest";
import { CommandParser } from "./command-parser";
import { resolveMenuItem } from "./menu-items";

describe("CommandParser: take", () => {
	it("!взять 2 → take, slot 2", () => {
		expect(CommandParser.parse("!взять 2")).toEqual({
			kind: "take",
			slot: 2,
			token: "2",
		});
	});

	it("алиас !take", () => {
		expect(CommandParser.parse("!take 3")).toEqual({
			kind: "take",
			slot: 3,
			token: "3",
		});
	});

	it("!взять без аргумента — slot null", () => {
		expect(CommandParser.parse("!взять")).toEqual({
			kind: "take",
			slot: null,
			token: "",
		});
	});

	it("!взять abc — slot null", () => {
		expect(CommandParser.parse("!взять abc")).toEqual({
			kind: "take",
			slot: null,
			token: "abc",
		});
	});

	it("«02» и «-1» — не номер слота", () => {
		const a = CommandParser.parse("!взять 02");
		const b = CommandParser.parse("!взять -1");
		if (a?.kind !== "take" || b?.kind !== "take") throw new Error("take?");
		expect(a.slot).toBeNull();
		expect(b.slot).toBeNull();
	});
});

describe("CommandParser: menu-алиасы", () => {
	it("!заказ и !order → menu", () => {
		expect(CommandParser.parse("!заказ")).toEqual({ kind: "menu" });
		expect(CommandParser.parse("!order")).toEqual({ kind: "menu" });
	});
});

describe("CommandParser: recipe", () => {
	it("!рецепт бургер → recipe с resolved-блюдом", () => {
		const parsed = CommandParser.parse("!рецепт бургер");
		expect(parsed?.kind).toBe("recipe");
		if (parsed?.kind === "recipe") {
			expect(parsed.item?.id).toBe("burger");
		}
	});

	it("алиас !recipe", () => {
		expect(CommandParser.parse("!recipe кола")?.kind).toBe("recipe");
	});

	it("!рецепт без аргумента — item null, token пустой", () => {
		expect(CommandParser.parse("!рецепт")).toEqual({
			kind: "recipe",
			item: null,
			token: "",
		});
	});

	it("неизвестное блюдо — item null, token сохранён", () => {
		const parsed = CommandParser.parse("!рецепт абракадабра");
		expect(parsed).toEqual({
			kind: "recipe",
			item: null,
			token: "абракадабра",
		});
	});
});

describe("CommandParser: next", () => {
	it("!next → next", () => {
		expect(CommandParser.parse("!next")).toEqual({ kind: "next" });
	});

	it("русский алиас !дальше", () => {
		expect(CommandParser.parse("!дальше")).toEqual({ kind: "next" });
		expect(CommandParser.parse("!ДАЛЬШЕ")).toEqual({ kind: "next" });
	});
});

describe("resolveMenuItem", () => {
	it("по id, полному имени и подстроке", () => {
		expect(resolveMenuItem("burger")?.id).toBe("burger");
		expect(resolveMenuItem("Бургер")?.id).toBe("burger");
		expect(resolveMenuItem("кол")?.id).toBe("cola");
	});

	it("неизвестное и пустое — null", () => {
		expect(resolveMenuItem("абракадабра")).toBeNull();
		expect(resolveMenuItem("")).toBeNull();
	});
});
