import { getGame } from "../lib/core/game/bootstrap";
import { startBotFromEnv } from "../lib/twitch/bootstrap";

let initialized = false;

function init(): void {
	if (initialized) return;
	initialized = true;
	const { sessionManager } = getGame();
	if (!startBotFromEnv(sessionManager)) {
		console.error(
			"[web] TWITCH_* не заданы — скопируй .env.example в .env и заполни.",
		);
		process.exit(1);
	}
}

init();
