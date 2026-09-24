import type { ChatClient } from "@twurple/chat";
import { safeErrorType } from "../core/observability";
import type { GameEvent } from "../core/game/game-event";
import { renderEvent } from "./replies";

export interface CommandSink {
	emit(event: GameEvent): void;
}

export class ChatSink implements CommandSink {
	constructor(
		private readonly client: ChatClient,
		private readonly channel: string,
	) {}

	emit(event: GameEvent): void {
		void this.client.say(this.channel, renderEvent(event)).catch((err) => {
			console.error(
				`[chat] не удалось отправить ответ в ${this.channel} (${event.correlationId}):`,
				{ cause: safeErrorType(err) },
			);
		});
	}
}

export class ListSink implements CommandSink {
	readonly events: GameEvent[] = [];

	emit(event: GameEvent): void {
		this.events.push(event);
	}
}
