import type { SessionManager } from "../core/game/session-manager";
import { startChatBot, type ChatBotConfig } from "./chat-bot";
import type { ChatClient } from "@twurple/chat";

const REQUIRED_BOT_ENV = [
	"TWITCH_CLIENT_ID",
	"TWITCH_ACCESS_TOKEN",
	"TWITCH_BOT_NAME",
] as const;

export type EnvLookup = Record<string, string | undefined>;

/** Список TWITCH_* переменных, которых не хватает для старта бота. */
export function missingBotEnvVars(env: EnvLookup): string[] {
	const missing: string[] = [];
	for (const name of REQUIRED_BOT_ENV) {
		if (!env[name]) missing.push(name);
	}
	const channels = (env.TWITCH_CHANNELS ?? "")
		.split(",")
		.map((c) => c.trim().replace(/^#/, ""))
		.filter(Boolean);
	if (channels.length === 0) missing.push("TWITCH_CHANNELS");
	return missing;
}

/** Читает TWITCH_* из env; null — хотя бы одна переменная не задана. */
export function readBotConfig(env: EnvLookup): ChatBotConfig | null {
	if (missingBotEnvVars(env).length > 0) return null;
	const clientId = env.TWITCH_CLIENT_ID!;
	const accessToken = env.TWITCH_ACCESS_TOKEN!;
	const botName = env.TWITCH_BOT_NAME!;
	const channels = (env.TWITCH_CHANNELS ?? "")
		.split(",")
		.map((c) => c.trim().replace(/^#/, ""))
		.filter(Boolean);
	return {
		clientId,
		accessToken,
		botName,
		channels,
		reactToSelf: env.TWITCH_REACT_TO_SELF === "1",
	};
}

/** Подключает чат-бота из env (в dev — $env, в prod — process.env). См. hooks. */
export function startBotFromEnv(
	sm: SessionManager,
	env: EnvLookup = process.env,
): ChatClient | null {
	const config = readBotConfig(env);
	if (!config) return null;
	const client = startChatBot(config, sm);
	client.connect();
	return client;
}
