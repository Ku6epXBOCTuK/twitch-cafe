import type { SessionManager } from "../core/game/session-manager";
import { startChatBot, type ChatBotConfig } from "./chat-bot";
import type { ChatClient } from "@twurple/chat";

/** Читает TWITCH_* из env; null — конфиг не заполнен, бот не нужен. */
export function readBotConfig(): ChatBotConfig | null {
	const env = process.env;
	const clientId = env.TWITCH_CLIENT_ID;
	const accessToken = env.TWITCH_ACCESS_TOKEN;
	const botName = env.TWITCH_BOT_NAME;
	const channels = (env.TWITCH_CHANNELS ?? "")
		.split(",")
		.map((c) => c.trim().replace(/^#/, ""))
		.filter(Boolean);
	if (!clientId || !accessToken || !botName || channels.length === 0)
		return null;
	return {
		clientId,
		accessToken,
		botName,
		channels,
		reactToSelf: env.TWITCH_REACT_TO_SELF === "1",
	};
}

/** Подключает чат-бота, если TWITCH_* заданы. null — бот не настроен. */
export function startBotFromEnv(sm: SessionManager): ChatClient | null {
	const config = readBotConfig();
	if (!config) return null;
	const client = startChatBot(config, sm);
	client.connect();
	return client;
}
