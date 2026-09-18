import type { OverlaySnapshot } from "#lib/overlay/types";
import { getGame } from "#lib/core/game/bootstrap";
import { project } from "#lib/overlay/projector";

const ENCODER = new TextEncoder();
const FRAME_INTERVAL_MS = 250;

/** O3: кадр = чистая проекция текущего состояния ядра. */
function currentSnapshot(): OverlaySnapshot {
	return project(getGame().sessionManager);
}

function frame(snapshot: OverlaySnapshot): Uint8Array {
	return ENCODER.encode(`data: ${JSON.stringify(snapshot)}\n\n`);
}

export function GET(): Response {
	let timer: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(frame(currentSnapshot()));
			timer = setInterval(() => {
				controller.enqueue(frame(currentSnapshot()));
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
