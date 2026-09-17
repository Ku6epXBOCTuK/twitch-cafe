import type { ChatClient } from "@twurple/chat";

/** Куда processMessage отправляет ответы: чат сейчас, SSE-оверлей позже. */
export interface CommandSink {
	reply(message: string): void;
}

/** Прод: ответы бота в канал Twitch. */
export class ChatSink implements CommandSink {
	constructor(
		private readonly client: ChatClient,
		private readonly channel: string,
	) {}

	reply(message: string): void {
		void this.client.say(this.channel, message).catch((err) => {
			console.error(
				`[chat] не удалось отправить ответ в ${this.channel}:`,
				err,
			);
		});
	}
}

/** Тесты: собирает реплики в массив для проверок. */
export class ListSink implements CommandSink {
	readonly messages: string[] = [];

	reply(message: string): void {
		this.messages.push(message);
	}
}
