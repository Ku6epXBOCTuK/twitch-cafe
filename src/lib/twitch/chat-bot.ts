import { StaticAuthProvider } from "@twurple/auth";
import { ChatClient } from "@twurple/chat";
import { Effect, Exit } from "effect";
import { safeCause, safeErrorType } from "../core/observability";
import {
	SESSION_LIFECYCLE_EVENT_TYPE,
	type SessionLifecycleEvent,
	type SessionManager,
} from "../core/game/session-manager";
import { CANCEL_REASON } from "../core/game/sim-dto";
import { processMessage } from "./chat-commands";
import { createCommandId } from "./command-context";
import { ChatSink } from "./command-sink";
import { replyOrderExpired } from "./replies";

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

export interface ChatBotHandle {
	readonly client: ChatClient;
	dispose(): void;
}

export function subscribeToTimeoutNotifications(
	sm: SessionManager,
	client: Pick<ChatClient, "say">,
	channel: string | undefined,
): () => void {
	if (!channel) return () => {};
	return sm.subscribeToLifecycle((event: SessionLifecycleEvent) => {
		if (
			event.type !== SESSION_LIFECYCLE_EVENT_TYPE.ORDER_EXPIRED ||
			event.reason !== CANCEL_REASON.TIMEOUT
		) {
			return;
		}
		const correlationId = createCommandId();
		void Promise.resolve()
			.then(() =>
				client.say(channel, replyOrderExpired(event.username, event.xpDelta)),
			)
			.catch((error) => {
				console.error(
					`[chat] не удалось отправить timeout в ${channel} (${correlationId}):`,
					{ cause: safeErrorType(error) },
				);
			});
	});
}

/** Подключает чат к игровому циклу: !команда → ответ в канал. */
export function startChatBot(
	config: ChatBotConfig,
	sm: SessionManager,
): ChatBotHandle {
	const authProvider = new StaticAuthProvider(
		config.clientId,
		config.accessToken,
		["chat:read", "chat:edit"],
	);
	const client = new ChatClient({ authProvider, channels: config.channels });
	const notificationChannel = config.channels[0];
	const unsubscribeLifecycle = subscribeToTimeoutNotifications(
		sm,
		client,
		notificationChannel,
	);

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

	let disposed = false;
	return {
		client,
		dispose() {
			if (disposed) return;
			disposed = true;
			unsubscribeLifecycle();
			client.quit();
		},
	};
}
