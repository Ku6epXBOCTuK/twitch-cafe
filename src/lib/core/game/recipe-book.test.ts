import { describe, expect, it } from "vitest";
import { burger, cola } from "#lib/test-support";
import { RecipeBook } from "./recipe-book";

describe("RecipeBook", () => {
	it("show запоминает блюдо", () => {
		const book = new RecipeBook();
		book.show(burger);
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
