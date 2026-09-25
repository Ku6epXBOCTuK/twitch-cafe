import type { SessionManager } from "../core/game/session-manager";
import type { ISimPort } from "../core/game/sim-port";
import { MENU_ITEMS } from "../core/data/menu";
import { makeSimEventQueue } from "../core/game/sim-port";
import { MiniplexSim } from "./simulation";
import { StubSim } from "./stub";

/** INGREDIENTS из рецептов + id простых предметов — валидные `!put`. */
function collectAllowedIngredientIds(): Set<string> {
	const ids = new Set<string>();
	for (const item of MENU_ITEMS) {
		if ("recipe" in item) {
			for (const ing of item.recipe.ingredients) ids.add(ing.id);
		} else {
			ids.add(item.id);
		}
	}
	return ids;
}

/** Единственное место, знающее оба слоя: SessionManager (RULE CORE) ↔ SIM. */
export function connectSim(sessionManager: SessionManager): ISimPort {
	const sim = new StubSim(makeSimEventQueue(), {
		allowedIngredientIds: collectAllowedIngredientIds(),
	});
	sessionManager.attachPort(sim);
	return sim;
}

export function connectMiniplexSim(
	sessionManager: SessionManager,
): MiniplexSim {
	const sim = new MiniplexSim(makeSimEventQueue(), {
		allowedIngredientIds: collectAllowedIngredientIds(),
	});
	sessionManager.attachPort(sim);
	return sim;
}
