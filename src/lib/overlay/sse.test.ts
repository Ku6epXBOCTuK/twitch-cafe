import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { getGameRuntime, shutdownGame } from "../core/game/bootstrap";
import { makeGameRuntime } from "../core/game/game-runtime";
import { projectSnapshot } from "./projector";
import type { OverlaySnapshot } from "./types";
import { GET } from "../../routes/api/overlay/sse/+server";
import { createOverlayStream } from "./sse";
import { burger } from "#lib/test-support";

type ParsedFrame = { data: OverlaySnapshot };

afterEach(() => {
	shutdownGame();
});

async function readNextFrame(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ParsedFrame> {
	const { value, done } = await reader.read();
	if (done || !value) throw new Error("SSE stream closed before event");
	const text = new TextDecoder().decode(value);
	const line = text.split("\n\n")[0]?.split("\n")[0];
	if (!line?.startsWith("data:")) throw new Error("Invalid SSE frame");
	return { data: JSON.parse(line.slice(5).trim()) as OverlaySnapshot };
}

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
	it("отдаёт text/event-stream", async () => {
		const response = GET();
		expect(response.headers.get("content-type")).toContain("text/event-stream");
		expect(response.headers.get("cache-control")).toContain("no-cache");
		await response.body?.cancel();
	});

	it("первый кадр стрима — проекция текущего ядра", async () => {
		const frames = await readFrames(GET(), 1);
		expect(frames).toHaveLength(1);

		const snapshot = frames[0].data;
		const runtime = getGameRuntime();
		expect(snapshot).toEqual(
			projectSnapshot(Effect.runSync(runtime.getSnapshot)),
		);

		expect(Object.keys(snapshot).sort()).toEqual([
			"execution",
			"incoming",
			"players",
			"recipe",
		]);
		expect(Array.isArray(snapshot.incoming)).toBe(true);
		expect(Array.isArray(snapshot.execution)).toBe(true);
		expect(Array.isArray(snapshot.players)).toBe(true);
		expect(
			snapshot.recipe === null || typeof snapshot.recipe === "object",
		).toBe(true);
	});

	it("delivers the initial snapshot and later state events", async () => {
		const runtime = makeGameRuntime();
		const reader = createOverlayStream(
			runtime.events.pipe(
				Stream.map((event) => projectSnapshot(event.snapshot)),
			),
		).getReader();

		const first = await readNextFrame(reader);
		expect(first.data).toEqual(
			projectSnapshot(Effect.runSync(runtime.getSnapshot)),
		);

		runtime.core.sessionManager.recipeBook.show(burger);
		const second = await readNextFrame(reader);
		expect(second.data.recipe).toEqual({
			id: burger.id,
			name: burger.name,
			ingredients: ["Нижняя булочка", "Котлета", "Сыр", "Верхняя булочка"],
		});

		await reader.cancel();
		Effect.runSync(runtime.shutdown);
	});

	it("interrupts the scoped event subscription when the client cancels", async () => {
		let finalized = false;
		const stream = Stream.never.pipe(
			Stream.ensuring(
				Effect.sync(() => {
					finalized = true;
				}),
			),
		);
		const reader = createOverlayStream(stream).getReader();

		await reader.cancel();
		expect(finalized).toBe(true);
	});
});
