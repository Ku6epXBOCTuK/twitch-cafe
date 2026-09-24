import type { IOrder } from "../core/types/order";
import type { ITraySnapshot } from "../core/types/tray";
import {
	ACTION_KIND,
	type CancelReason,
	type TaskAck,
	type TaskIntent,
} from "../core/game/sim-dto";
import type { ISimEvents, ISimPort } from "../core/game/sim-port";
import type { SimSnapshot } from "../core/game/sim-dto";

export class RecordingPort implements ISimPort {
	events: ISimEvents | null = null;
	private readonly orderIds = new Map<string, string>();
	private sequence = 0;
	startOrders: IOrder[] = [];
	tasks: Array<{ username: string; intent: TaskIntent }> = [];
	cancels: CancelReason[] = [];
	trayLayers: string[] = [];
	clearTrayCalls = 0;

	attach(events: ISimEvents): void {
		this.events = events;
	}

	startOrder(username: string, order: IOrder): void {
		this.startOrders.push(order);
		this.orderIds.set(username, order.id);
	}

	enqueueTask(username: string, intent: TaskIntent): TaskAck {
		this.tasks.push({ username, intent });
		if (intent.kind === ACTION_KIND.SERVE) {
			this.events?.onActionCompleted({
				type: "ACTION_COMPLETED",
				username,
				orderId: this.orderIds.get(username) ?? "",
				sequence: ++this.sequence,
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

	cancelOrder(_username: string, reason: CancelReason): void {
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
