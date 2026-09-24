import {
	TWITCH_ACCESS_TOKEN,
	TWITCH_BOT_NAME,
	TWITCH_CHANNELS,
	TWITCH_CLIENT_ID,
	TWITCH_REACT_TO_SELF,
} from "$app/env/private";
import { getGameRuntime, shutdownGame } from "#lib/core/game/bootstrap";
import { missingBotEnvVars } from "#lib/twitch/bootstrap";
import { startBotFromEnv } from "#lib/twitch/bootstrap";

import type { ChatBotHandle } from "#lib/twitch/chat-bot";

let initialized = false;
let botHandle: ChatBotHandle | null = null;

function init(): void {
	if (initialized) return;
	initialized = true;
	const env: Record<string, string | undefined> = {
		TWITCH_CLIENT_ID,
		TWITCH_ACCESS_TOKEN,
		TWITCH_BOT_NAME,
		TWITCH_CHANNELS,
		TWITCH_REACT_TO_SELF,
	};
	const missing = missingBotEnvVars(env);
	if (missing.length > 0) {
		console.error(
			`[web] не хватает переменных: ${missing.join(", ")} — скопируй .env.example в .env и заполни.`,
		);
		process.exit(1);
	}
	const { sessionManager } = getGameRuntime().core;
	botHandle = startBotFromEnv(sessionManager, env);
}

function disposeApplication(): void {
	botHandle?.dispose();
	botHandle = null;
	shutdownGame();
	process.removeListener("SIGTERM", onSigterm);
	process.removeListener("SIGINT", onSigint);
}

const onSigterm = () => {
	disposeApplication();
	process.exit(0);
};
const onSigint = () => {
	disposeApplication();
	process.exit(0);
};

init();

if (import.meta.hot) {
	import.meta.hot.dispose(disposeApplication);
}

process.once("SIGTERM", onSigterm);
process.once("SIGINT", onSigint);
