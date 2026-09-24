import type { ChatClient } from "@twurple/chat";
import { describe, expect, it, vi } from "vitest";
import { GAME_EVENT_TYPE, type GameEvent } from "../core/game/game-event";
import { ChatSink } from "./command-sink";

const event: GameEvent = {
	type: GAME_EVENT_TYPE.NOT_IN_GAME,
	username: "alice",
	correlationId: "command-1",
};

describe("ChatSink", () => {
	it("reports send rejection without throwing or logging payload details", async () => {
		const error = Object.assign(new Error("token=secret"), {
			name: "NetworkError",
		});
		const say = vi.fn().mockRejectedValue(error);
		const client = { say } as unknown as ChatClient;
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const sink = new ChatSink(client, "channel");

		expect(() => sink.emit(event)).not.toThrow();
		await Promise.resolve();
		expect(say).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith(
			"[chat] не удалось отправить ответ в channel (command-1):",
			{ cause: "NetworkError" },
		);
		expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
	});
});
