import { afterEach, describe, expect, it, vi } from "vitest";
import { connect, disconnect } from "./overlay-store";

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;
	closed = false;

	constructor(readonly url: string) {
		FakeEventSource.instances.push(this);
	}

	close(): void {
		this.closed = true;
	}
}

afterEach(() => {
	disconnect();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	FakeEventSource.instances = [];
});

describe("overlay-store lifecycle", () => {
	it("does not throw on malformed SSE data", () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		connect();
		const source = FakeEventSource.instances[0];

		expect(() => source?.onmessage?.({ data: "not-json" })).not.toThrow();
		expect(warn).toHaveBeenCalledWith("[overlay] invalid SSE payload");
	});

	it("cancels reconnect timer on disconnect", () => {
		vi.useFakeTimers();
		vi.stubGlobal("EventSource", FakeEventSource);
		connect();
		const source = FakeEventSource.instances[0];
		source?.onerror?.();
		expect(source?.closed).toBe(true);

		disconnect();
		vi.advanceTimersByTime(3000);
		expect(FakeEventSource.instances).toHaveLength(1);
	});

	it("ignores stale source callbacks after disconnect", () => {
		vi.useFakeTimers();
		vi.stubGlobal("EventSource", FakeEventSource);
		connect();
		const stale = FakeEventSource.instances[0];
		disconnect();
		connect();
		const current = FakeEventSource.instances[1];

		stale?.onerror?.();
		vi.advanceTimersByTime(3000);
		expect(FakeEventSource.instances).toHaveLength(2);
		current?.onerror?.();
		vi.advanceTimersByTime(3000);
		expect(FakeEventSource.instances).toHaveLength(3);
	});
});
