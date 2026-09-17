import type { IOrder } from "../core/types/order";
import type { ITraySnapshot } from "../core/types/tray";
import type { ISimPort } from "../core/game/sim-port";
import type { ISimEvents } from "../core/game/sim-port";
import type { SimSnapshot, TaskAck, TaskIntent } from "../core/game/sim-dto";

interface StubPlayer {
	username: string;
	orderId: string;
	layers: string[];
	startedAt: number;
}

export interface StubSimOptions {
	/** Валидные для `!put` id: ингредиенты + простые предметы меню. */
	allowedIngredientIds: ReadonlySet<string>;
}

/**
 * Провизорная SIM: каждое действие завершается мгновенно в момент запроса.
 * Тот же ISimPort, что у реальной miniplex-симуляции, — замена происходит
 * без правок в SessionManager и слое чата.
 */
export class StubSim implements ISimPort {
	private readonly players = new Map<string, StubPlayer>();

	constructor(
		private readonly events: ISimEvents,
		private readonly options: StubSimOptions,
	) {}

	startOrder(username: string, order: IOrder): void {
		const existing = this.players.get(username);
		this.players.set(username, {
			username,
			orderId: order.id,
			layers: [],
			startedAt: Date.now(),
		});
		if (!existing) return;
		// новый заказ — чистый поднос (слои прошлого serve сброшены)
	}

	enqueueTask(username: string, intent: TaskIntent): TaskAck {
		const player = this.players.get(username);
		if (!player) return { ok: false, reason: "no_character" };

		const now = Date.now();
		const base = {
			type: "ACTION_COMPLETED" as const,
			username,
			finishedAt: now,
			action: { kind: intent.kind, targetId: 0, startedAt: player.startedAt },
		};

		if (intent.kind === "put") {
			if (!this.options.allowedIngredientIds.has(intent.ingredientId)) {
				return { ok: false, reason: "unknown_ingredient" };
			}
			player.layers.push(intent.ingredientId);
			this.events.onActionCompleted({
				...base,
				action: { ...base.action, ingredientId: intent.ingredientId },
			});
			return { ok: true };
		}

		if (intent.kind === "bin") {
			player.layers.length = 0;
			this.events.onActionCompleted(base);
			return { ok: true };
		}

		if (player.layers.length === 0) {
			return { ok: false, reason: "tray_empty" };
		}
		this.events.onActionCompleted({
			...base,
			tray: { username, layers: [...player.layers], frozenAt: now },
		});
		return { ok: true };
	}

	cancelOrder(username: string, _reason: "timeout" | "leave"): void {
		const player = this.players.get(username);
		if (player) player.layers.length = 0;
	}

	despawn(username: string): void {
		if (!this.players.delete(username)) return;
		this.events.onCharacterRemoved({ type: "CHARACTER_REMOVED", username });
	}

	getTraySnapshot(username: string): ITraySnapshot | undefined {
		const player = this.players.get(username);
		if (!player) return undefined;
		return { username, layers: [...player.layers], frozenAt: Date.now() };
	}

	getSnapshot(): SimSnapshot {
		return {
			simTime: Date.now(),
			characters: [...this.players.values()].map((p) => ({
				username: p.username,
				x: 0,
				y: 0,
				tray: [...p.layers],
			})),
		};
	}
}
