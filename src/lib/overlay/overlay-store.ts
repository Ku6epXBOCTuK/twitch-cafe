import { writable, type Writable } from "svelte/store";
import type { OverlaySnapshot } from "./types";

export const snapshot: Writable<OverlaySnapshot> = writable({
	incoming: [],
	execution: [],
	players: [],
	recipe: null,
});

let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connectionGeneration = 0;

function isOverlaySnapshot(value: unknown): value is OverlaySnapshot {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return (
		Array.isArray(candidate.incoming) &&
		Array.isArray(candidate.execution) &&
		Array.isArray(candidate.players) &&
		(candidate.recipe === null || typeof candidate.recipe === "object")
	);
}

export function connect(): void {
	if (source) return;
	const generation = connectionGeneration;
	const nextSource = new EventSource("/api/overlay/sse");
	source = nextSource;
	nextSource.onmessage = (event) => {
		if (generation !== connectionGeneration) return;
		try {
			const value: unknown = JSON.parse(event.data);
			if (isOverlaySnapshot(value)) snapshot.set(value);
			else console.warn("[overlay] invalid SSE snapshot");
		} catch {
			console.warn("[overlay] invalid SSE payload");
		}
	};
	nextSource.onerror = () => {
		if (generation !== connectionGeneration) return;
		nextSource.close();
		if (source === nextSource) source = null;
		if (!reconnectTimer) {
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				if (generation === connectionGeneration) connect();
			}, 3000);
		}
	};
}

export function disconnect(): void {
	connectionGeneration += 1;
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	source?.close();
	source = null;
}

if (import.meta.hot) {
	import.meta.hot.dispose(() => disconnect());
}
