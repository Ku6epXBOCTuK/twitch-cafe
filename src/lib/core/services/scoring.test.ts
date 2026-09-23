import { describe, expect, it } from "vitest";
import { SCORING_CONFIG, verdictFor, xpForRating } from "./scoring";

describe("scoring policy", () => {
	it("maps configured rating boundaries to verdicts", () => {
		expect(verdictFor(SCORING_CONFIG.PERFECT)).toBe("perfect");
		expect(verdictFor(SCORING_CONFIG.GOOD)).toBe("good");
		expect(verdictFor(SCORING_CONFIG.OK)).toBe("ok");
		expect(verdictFor(0)).toBe("awful");
	});

	it("uses the configured XP base symmetrically", () => {
		expect(xpForRating(1)).toBe(SCORING_CONFIG.XP_BASE);
		expect(xpForRating(0.5)).toBe(0);
		expect(xpForRating(0)).toBe(-SCORING_CONFIG.XP_BASE);
	});
});
