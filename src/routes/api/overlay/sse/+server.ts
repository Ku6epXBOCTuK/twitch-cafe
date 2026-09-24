import { Stream } from "effect";
import { getGameRuntime } from "#lib/core/game/bootstrap";
import { projectSnapshot } from "#lib/overlay/projector";
import { createOverlayStream } from "#lib/overlay/sse";

export function GET(): Response {
	const runtime = getGameRuntime();
	const stream = createOverlayStream(
		runtime.events.pipe(Stream.map((event) => projectSnapshot(event.snapshot))),
	);

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
		},
	});
}
