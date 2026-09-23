import type { IMenuItemBase, IMenuItemComposite } from "../types/menu_item";
import { MENU_ITEM_VARIANT } from "../types/menu_item";
import type { IOrder } from "../types/order";
import type { ITraySnapshot } from "../types/tray";
import type { Verdict } from "./scoring";
import { computeRating, verdictFor, xpForRating } from "./scoring";

export interface AssessmentResult {
	/** Доля «правильности» сборки: 0..1, среднее по позициям заказа. */
	rating: number;
	verdict: Verdict;
	missing: string[];
	extra: string[];
	orderIssues: string[];
	xpDelta: number;
}

interface ItemAssessment {
	rating: number;
	missing: string[];
	extra: string[];
	orderIssues: string[];
}

function isComposite(item: IMenuItemBase): item is IMenuItemComposite {
	return item.variant === MENU_ITEM_VARIANT.COMPOSITE;
}

interface LayerCountComparison {
	missing: string[];
	extra: string[];
	matched: string[];
}

function compareLayerCounts(
	expected: string[],
	actual: string[],
): LayerCountComparison {
	const remaining = new Map<string, number>();
	for (const id of expected) {
		remaining.set(id, (remaining.get(id) ?? 0) + 1);
	}

	const extra: string[] = [];
	const matched: string[] = [];
	for (const id of actual) {
		const count = remaining.get(id) ?? 0;
		if (count === 0) {
			extra.push(id);
			continue;
		}
		remaining.set(id, count - 1);
		matched.push(id);
	}

	const missing: string[] = [];
	for (const id of expected) {
		const count = remaining.get(id) ?? 0;
		if (count > 0) {
			missing.push(id);
			remaining.set(id, count - 1);
		}
	}

	return { missing, extra, matched };
}

function assessSimple(
	item: IMenuItemBase,
	layers: string[],
	strictness: number,
): ItemAssessment {
	const comparison = compareLayerCounts([item.id], layers);
	if (comparison.matched.length === 0) {
		return {
			rating: 0,
			missing: comparison.missing,
			extra: comparison.extra,
			orderIssues: [],
		};
	}
	if (comparison.extra.length === 0) {
		return { rating: 1, missing: [], extra: [], orderIssues: [] };
	}
	return {
		rating: computeRating(
			{
				missing: 0,
				extra: comparison.extra.length,
				wrongOrder: 0,
				baseViolations: 0,
			},
			strictness,
		),
		missing: [],
		extra: comparison.extra,
		orderIssues: [],
	};
}

function assessComposite(
	item: IMenuItemComposite,
	layers: string[],
	strictness: number,
): ItemAssessment {
	const recipe = item.recipe;
	const canonical = recipe.ingredients.map((ing) => ing.id);
	const baseIds = new Set(
		recipe.ingredients
			.filter((ing) => ing.category === "base")
			.map((ing) => ing.id),
	);
	const { missing, extra, matched } = compareLayerCounts(canonical, layers);
	const orderIssues: string[] = [];

	let wrongOrder = 0;
	let baseViolations = 0;

	if (recipe.fillingOrder === "ordered") {
		const nonBaseCanonical = canonical.filter((id) => !baseIds.has(id));
		const nonBaseInTray = matched.filter((id) => !baseIds.has(id));
		for (
			let i = 0;
			i < Math.min(nonBaseCanonical.length, nonBaseInTray.length);
			i++
		) {
			if (nonBaseCanonical[i] !== nonBaseInTray[i]) wrongOrder++;
		}
		if (wrongOrder > 0) orderIssues.push("порядок начинки нарушен");
	} else {
		const canonicalBases = canonical.filter((id) => baseIds.has(id));
		const baseInTray = layers.filter((id) => baseIds.has(id));
		if (baseInTray.length > 0 && layers[0] !== canonicalBases[0]) {
			baseViolations++;
		}
		if (
			baseInTray.length > 1 &&
			layers[layers.length - 1] !== canonicalBases[canonicalBases.length - 1]
		) {
			baseViolations++;
		}
		if (baseViolations > 0) orderIssues.push("база не на своём месте");
	}

	const rating = computeRating(
		{
			missing: missing.length,
			extra: extra.length,
			wrongOrder,
			baseViolations,
		},
		strictness,
	);
	return { rating, missing, extra, orderIssues };
}

function assessItem(
	item: IMenuItemBase,
	layers: string[],
	strictness: number,
): ItemAssessment {
	if (isComposite(item)) return assessComposite(item, layers, strictness);
	return assessSimple(item, layers, strictness);
}

export class OrderValidator {
	/**
	 * Dishes-модель: запечатанные блюда (sealed) оцениваются против
	 * items[0..len-2], текущий поднос (current) — против последнего блюда.
	 */
	static assessOrderDishes(
		sealed: ITraySnapshot[],
		current: ITraySnapshot | null,
		order: IOrder,
	): AssessmentResult {
		const strictness = order.customer.strictness;

		if (order.items.length === 0) {
			return {
				rating: 0,
				verdict: "awful",
				missing: [],
				extra: [],
				orderIssues: [],
				xpDelta: 0,
			};
		}

		const dishCount = order.items.length;
		const assessments: ItemAssessment[] = [];
		for (let i = 0; i < dishCount; i++) {
			const layers =
				i < dishCount - 1 ? (sealed[i]?.layers ?? []) : (current?.layers ?? []);
			assessments.push(assessItem(order.items[i].item, layers, strictness));
		}

		const rating =
			assessments.reduce((sum, a) => sum + a.rating, 0) / assessments.length;

		const missing = [...new Set(assessments.flatMap((a) => a.missing))];
		const extra = [...new Set(assessments.flatMap((a) => a.extra))];
		const orderIssues = assessments.flatMap((a) => a.orderIssues);

		return {
			rating,
			verdict: verdictFor(rating),
			missing,
			extra,
			orderIssues,
			xpDelta: xpForRating(rating),
		};
	}
}
