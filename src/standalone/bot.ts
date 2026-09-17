import { SessionManager } from "../lib/core/game/session-manager";
import { connectSim } from "../lib/sim/sync";
import { startChatBot } from "../lib/twitch/chat-bot";

const env = process.env;

function required(name: string): string {
	const value = env[name];
	if (!value) {
		console.error(
			`[bot] не хватает переменной ${name} — скопируй .env.example в .env и заполни.`,
		);
		process.exit(1);
	}
	return value;
}

const clientId = required("TWITCH_CLIENT_ID");
const accessToken = required("TWITCH_ACCESS_TOKEN");
const botName = required("TWITCH_BOT_NAME");
const channels = (env.TWITCH_CHANNELS ?? "")
	.split(",")
	.map((c) => c.trim().replace(/^#/, ""))
	.filter(Boolean);
if (channels.length === 0) {
	console.error("[bot] задай TWITCH_CHANNELS через запятую.");
	process.exit(1);
}

const sm = new SessionManager();
connectSim(sm);

const client = startChatBot(
	{
		clientId,
		accessToken,
		botName,
		channels,
		reactToSelf: env.TWITCH_REACT_TO_SELF === "1",
	},
	sm,
);

client.connect();

const shutdown = (signal: string) => {
	console.log(`[bot] получен ${signal}, выключаюсь…`);
	client.quit();
	process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
