import { Cause } from "effect";
import { describe, expect, it } from "vitest";
import { safeCause, safeErrorType } from "./observability";

describe("safe observability labels", () => {
	it("does not expose error messages or stack traces", () => {
		const error = Object.assign(new Error("token=secret"), {
			name: "SimFailure",
			stack: "secret stack",
		});
		expect(safeErrorType(error)).toBe("SimFailure");
		expect(safeCause(Cause.die(error))).toBe("SimFailure");
	});

	it("uses tagged error names without serializing payload", () => {
		expect(safeErrorType({ _tag: "Busy", token: "secret" })).toBe("Busy");
	});
});
