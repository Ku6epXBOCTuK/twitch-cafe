import { Stream } from "effect";
import type { OverlaySnapshot } from "./types";

const ENCODER = new TextEncoder();

function frame(snapshot: OverlaySnapshot): Uint8Array {
	return ENCODER.encode(`data: ${JSON.stringify(snapshot)}\n\n`);
}

export function createOverlayStream(
	events: Stream.Stream<OverlaySnapshot>,
): ReadableStream<Uint8Array> {
	return Stream.toReadableStream(events.pipe(Stream.map(frame)));
}
