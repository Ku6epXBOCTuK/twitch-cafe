import { describe, expect, it } from "vitest";
import { getGame } from "../core/game/bootstrap";
import { project } from "./projector";
import type { OverlaySnapshot } from "./types";
import { GET } from "../../routes/api/overlay/sse/+server";

type ParsedFrame = { data: OverlaySnapshot };

async function readFrames(
	response: Response,
	count: number,
): Promise<ParsedFrame[]> {
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	const frames: ParsedFrame[] = [];

	while (frames.length < count) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const parts = buffer.split("\n\n");
		buffer = parts.pop() ?? "";
		for (const part of parts) {
			if (!part.trim()) continue;
			const [line] = part.split("\n");
			if (!line?.startsWith("data:")) continue;
			frames.push({ data: JSON.parse(line.slice(5).trim()) });
		}
	}

	await reader.cancel();
	return frames;
}

describe("SSE-роут /api/overlay/sse", () => {
	it("отдаёт text/event-stream", () => {
		const response = GET();
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toContain("no-cache");
	});

	it("первый кадр стрима — проекция текущего ядра", async () => {
		const frames = await readFrames(GET(), 1);
		expect(frames).toHaveLength(1);

		const snapshot = frames[0].data;
		// Ядро в тесте пустое: кадр совпадает с прямым вызовом проектора.
		expect(snapshot).toEqual(project(getGame().sessionManager));

		expect(Array.isArray(snapshot.incoming)).toBe(true);
		expect(Array.isArray(snapshot.execution)).toBe(true);
		expect(Array.isArray(snapshot.players)).toBe(true);
		expect(
			snapshot.recipe === null || typeof snapshot.recipe === "object",
		).toBe(true);
	});
});
