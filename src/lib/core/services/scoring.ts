export const VERDICT = {
	PERFECT: "perfect",
	GOOD: "good",
	OK: "ok",
	BAD: "bad",
	AWFUL: "awful",
} as const;

export type Verdict = (typeof VERDICT)[keyof typeof VERDICT];

export interface RatingDeltas {
	missing: number;
	extra: number;
	wrongOrder: number;
	baseViolations: number;
}

export const SCORING_CONFIG = {
	COST_MISSING: 0.3,
	COST_EXTRA: 0.1,
	COST_ORDER: 0.2,
	COST_BASE: 1.3,
	PERFECT: 0.9,
	GOOD: 0.7,
	OK: 0.4,
	XP_BASE: 50,
} as const;

/** Единственное место, где крутится баланс формулы из docs/plan.md §4. */
export function computeRating(
	deltas: RatingDeltas,
	strictness: number,
): number {
	const strictScale = 0.25 + 0.75 * strictness;
	const rating =
		1 -
		deltas.missing * SCORING_CONFIG.COST_MISSING * strictScale -
		deltas.extra * SCORING_CONFIG.COST_EXTRA * strictScale -
		deltas.wrongOrder * SCORING_CONFIG.COST_ORDER * strictness -
		deltas.baseViolations * SCORING_CONFIG.COST_BASE * strictness;
	return Math.min(1, Math.max(0, rating));
}

export function verdictFor(rating: number): Verdict {
	if (rating >= SCORING_CONFIG.PERFECT) return VERDICT.PERFECT;
	if (rating >= SCORING_CONFIG.GOOD) return VERDICT.GOOD;
	if (rating >= SCORING_CONFIG.OK) return VERDICT.OK;
	if (rating > 0) return VERDICT.BAD;
	return VERDICT.AWFUL;
}

/** Symmetрично: идеал +XP_BASE, ноль −XP_BASE, полсередины — 0. */
export function xpForRating(rating: number): number {
	return Math.round(SCORING_CONFIG.XP_BASE * (2 * rating - 1));
}
