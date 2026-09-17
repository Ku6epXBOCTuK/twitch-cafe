import { writable, type Writable } from "svelte/store";

export interface OverlaySnapshot {
	incoming: { id: string; label: string }[];
	execution: { id: string; label: string }[];
	recipe: { id: string; label: string } | null;
}

export const snapshot: Writable<OverlaySnapshot> = writable({
	incoming: [],
	execution: [],
	recipe: null,
});

let source: EventSource | null = null;

export function connect(): void {
	if (source) return;
	source = new EventSource("/api/overlay/sse");
	source.onmessage = (e) => {
		snapshot.set(JSON.parse(e.data));
	};
	source.onerror = () => {
		source?.close();
		source = null;
	};
}
