import {
	TWITCH_ACCESS_TOKEN,
	TWITCH_BOT_NAME,
	TWITCH_CHANNELS,
	TWITCH_CLIENT_ID,
	TWITCH_REACT_TO_SELF,
} from "$app/env/private";
import { getGame } from "#lib/core/game/bootstrap";
import { missingBotEnvVars } from "#lib/twitch/bootstrap";
import { startBotFromEnv } from "#lib/twitch/bootstrap";

let initialized = false;

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
	const { sessionManager } = getGame();
	startBotFromEnv(sessionManager, env);
}

init();
