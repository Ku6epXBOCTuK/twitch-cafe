import { afterEach, describe, expect, it, vi } from "vitest";
import { getGameRuntime, shutdownGame } from "./bootstrap";

afterEach(() => {
	shutdownGame();
	vi.useRealTimers();
});

describe("runtime bootstrap lifecycle", () => {
	it("recreates the runtime after shutdown", () => {
		vi.useFakeTimers();
		const first = getGameRuntime();
		expect(first.isRunning()).toBe(true);

		shutdownGame();
		const second = getGameRuntime();

		expect(second).not.toBe(first);
		expect(second.isRunning()).toBe(true);
	});
});
