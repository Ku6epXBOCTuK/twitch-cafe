import { StaticAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import { Effect, Exit } from "effect";
import { safeCause } from "../core/observability";
import type { SessionManager } from "../core/game/session-manager";
import { processMessage } from "./chat-commands";
import { createCommandId } from "./command-context";
import { ChatSink } from "./command-sink";

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

		const correlationId = createCommandId();
		const command = processMessage(
			text,
			user,
			sm,
			new ChatSink(client, channel),
			correlationId,
		);
		void Effect.runPromiseExit(command).then((exit) => {
			if (Exit.isFailure(exit)) {
				console.error(
					`[chat] ${user} (${correlationId}): обработка сломалась:`,
					{ cause: safeCause(exit.cause) },
				);
			}
		});
	});

	client.onAuthenticationSuccess(() => {
		console.log(
			`[chat] бот подключён как ${config.botName}, каналы: ${config.channels.join(", ")}`,
		);
	});

	return client;
}
