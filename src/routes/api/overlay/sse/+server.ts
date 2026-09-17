import type { OverlaySnapshot } from "#lib/overlay/types";

const ENCODER = new TextEncoder();
const FRAME_INTERVAL_MS = 250;

/** O3: проекция будет собирать кадр из SimSnapshot. Пока — пустые доски. */
function stubSnapshot(): OverlaySnapshot {
	return { incoming: [], execution: [], recipe: null };
}

function frame(snapshot: OverlaySnapshot): Uint8Array {
	return ENCODER.encode(`data: ${JSON.stringify(snapshot)}\n\n`);
}

export function GET(): Response {
	let timer: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(frame(stubSnapshot()));
			timer = setInterval(() => {
				controller.enqueue(frame(stubSnapshot()));
			}, FRAME_INTERVAL_MS);
		},
		cancel() {
			if (timer) clearInterval(timer);
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
		},
	});
}
