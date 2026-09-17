import { describe, expect, it } from "vitest";
import { MENU_ITEMS } from "../data/menu";
import { RecipeBook } from "./recipe-book";

const burger = MENU_ITEMS.find((m) => m.id === "burger")!;
const cola = MENU_ITEMS.find((m) => m.id === "cola")!;

describe("RecipeBook", () => {
	it("show ok: возвращает блюдо и запоминает его", () => {
		const book = new RecipeBook();
		const res = book.show(burger);
		expect(res).toEqual({ ok: true, item: burger });
		expect(book.getCurrent()).toBe(burger);
	});

	it("show unknown: отказ, current не сбрасывается", () => {
		const book = new RecipeBook();
		book.show(burger);

		expect(book.show(null)).toEqual({ ok: false, reason: "unknown_item" });
		expect(book.getCurrent()).toBe(burger);
	});

	it("повторный show заменяет current", () => {
		const book = new RecipeBook();
		book.show(burger);
		book.show(cola);
		expect(book.getCurrent()).toBe(cola);
	});

	it("stop очищает current", () => {
		const book = new RecipeBook();
		book.show(burger);
		book.stop();
		expect(book.getCurrent()).toBeNull();
	});
});
