import { StaticAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import type { SessionManager } from "../core/game/session-manager";
import { processMessage } from "./chat-commands";

export interface ChatBotConfig {
	/** Client ID приложения из dev.twitch.tv/console/apps. */
	clientId: string;
	/** User-токен с scopes chat:read chat:edit (владелец токена = аккаунт бота). */
	accessToken: string;
	/** Ник аккаунта, под которым бот заходит и пишет в чат. */
	botName: string;
	/** Каналы, в которых играет бот (без #). */
	channels: string[];
	/** Отвечать ли на команды с аккаунта самого бота (для тестов с одного аккаунта). */
	reactToSelf?: boolean;
}

/** Подключает чат к игровому циклу: !команда → ответ в канал. */
export function startChatBot(
	config: ChatBotConfig,
	sm: SessionManager,
): ChatClient {
	const authProvider = new StaticAuthProvider(
		config.clientId,
		config.accessToken,
		["chat:read", "chat:edit"],
	);
	const client = new ChatClient({ authProvider, channels: config.channels });

	client.onMessage((channel, user, text) => {
		if (
			!config.reactToSelf &&
			user.toLowerCase() === config.botName.toLowerCase()
		)
			return;

		let reply: string | null;
		try {
			reply = processMessage(text, user, sm);
		} catch (err) {
			console.error(`[chat] ${user}: обработка сломалась:`, err);
			return;
		}
		if (!reply) return;

		void client.say(channel, reply).catch((err) => {
			console.error(`[chat] не удалось отправить ответ в ${channel}:`, err);
		});
	});

	client.onAuthenticationSuccess(() => {
		console.log(
			`[chat] бот подключён как ${config.botName}, каналы: ${config.channels.join(", ")}`,
		);
	});

	return client;
}
