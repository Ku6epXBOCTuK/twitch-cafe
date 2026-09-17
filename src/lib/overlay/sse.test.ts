import { describe, expect, it } from "vitest";
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

	it("стримит кадры снапшота с корректной формой", async () => {
		const frames = await readFrames(GET(), 2);
		expect(frames.length).toBeGreaterThanOrEqual(2);
		for (const frame of frames) {
			expect(Array.isArray(frame.data.incoming)).toBe(true);
			expect(Array.isArray(frame.data.execution)).toBe(true);
			expect(frame.data.recipe).toBeNull();
		}
	});
});
