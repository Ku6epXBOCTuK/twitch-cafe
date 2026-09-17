import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
	TWITCH_CLIENT_ID: {
		description: "Client ID приложения: https://dev.twitch.tv/console/apps",
	},
	TWITCH_ACCESS_TOKEN: {
		description: "User-токен аккаунта бота со scopes: chat:read chat:edit",
	},
	TWITCH_BOT_NAME: {
		description: "Ник аккаунта бота — под ним бот пишет в чат.",
	},
	TWITCH_CHANNELS: {
		description:
			"Каналы через запятую, без #. Например: my_channel,some_friend",
	},
	// TODO: на удаление, бот позже не будет отвечать в чате
	TWITCH_REACT_TO_SELF: {
		description:
			"Тест с одного аккаунта: бот отвечает и на свои команды. Поставь 1.",
	},
	PORT: {
		description:
			"Порт веб-сервера (SvelteKit + SSE). По умолчанию 5173 в dev, 4311 в проде.",
	},
});
