import { writable, type Writable } from "svelte/store";
import type { OverlaySnapshot } from "./types";

export const snapshot: Writable<OverlaySnapshot> = writable({
	incoming: [],
	execution: [],
	recipe: null,
});

let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connect(): void {
	if (source) return;
	source = new EventSource("/api/overlay/sse");
	source.onmessage = (e) => {
		snapshot.set(JSON.parse(e.data));
	};
	source.onerror = () => {
		source?.close();
		source = null;
		if (!reconnectTimer) {
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, 3000);
		}
	};
}

export function disconnect(): void {
	if (reconnectTimer) {
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
	}
	source?.close();
	source = null;
}
