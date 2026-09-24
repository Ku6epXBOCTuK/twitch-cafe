import type { IOrder } from "../core/types/order";
import type { ITraySnapshot } from "../core/types/tray";
import {
	ACTION_KIND,
	type TaskAck,
	type TaskIntent,
} from "../core/game/sim-dto";
import type { ISimEvents, ISimPort } from "../core/game/sim-port";
import type { SimSnapshot } from "../core/game/sim-dto";

export class RecordingPort implements ISimPort {
	events: ISimEvents | null = null;
	startOrders: IOrder[] = [];
	tasks: Array<{ username: string; intent: TaskIntent }> = [];
	cancels: Array<"timeout" | "leave"> = [];
	trayLayers: string[] = [];
	clearTrayCalls = 0;

	attach(events: ISimEvents): void {
		this.events = events;
	}

	startOrder(_username: string, order: IOrder): void {
		this.startOrders.push(order);
	}

	enqueueTask(username: string, intent: TaskIntent): TaskAck {
		this.tasks.push({ username, intent });
		if (intent.kind === ACTION_KIND.SERVE) {
			this.events?.onActionCompleted({
				type: "ACTION_COMPLETED",
				username,
				finishedAt: Date.now(),
				action: { kind: ACTION_KIND.SERVE, targetId: 0, startedAt: 0 },
				tray: {
					username,
					layers: [...this.trayLayers],
					frozenAt: Date.now(),
				},
			});
			return { ok: true };
		}
		if (intent.kind === ACTION_KIND.BIN) this.trayLayers = [];
		if (intent.kind === ACTION_KIND.PUT)
			this.trayLayers.push(intent.ingredientId);
		return { ok: true };
	}

	cancelOrder(_username: string, reason: "timeout" | "leave"): void {
		this.cancels.push(reason);
	}

	clearTray(): void {
		this.clearTrayCalls++;
		this.trayLayers = [];
	}

	despawn(): void {}

	getTraySnapshot(username: string): ITraySnapshot {
		return { username, layers: [...this.trayLayers], frozenAt: 0 };
	}

	getSnapshot(): SimSnapshot {
		return { simTime: 0, characters: [] };
	}
}
