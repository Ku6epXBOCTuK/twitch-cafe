import { Clock, Context, Effect, Layer, Logger, Random } from "effect";
import { connectSim } from "../../sim/sync";
import { ORDER_CONFIG } from "../config";
import { SessionManager } from "./session-manager";
import type { ISimPort } from "./sim-port";

export interface GameConfig {
	readonly SLOT_COUNT: number;
	readonly SPAWN_INTERVAL_MS: number;
	readonly SLOT_LIFETIME_MS: number;
	readonly ORDER_TIME_LIMIT_MS: number;
}

export const DEFAULT_GAME_CONFIG = ORDER_CONFIG satisfies GameConfig;

export const GameConfig = Context.Reference<GameConfig>("GameConfig", {
	defaultValue: () => DEFAULT_GAME_CONFIG,
});

export const gameRuntimeLayer = (config: GameConfig = DEFAULT_GAME_CONFIG) =>
	Layer.mergeAll(
		Layer.succeed(GameConfig, config),
		Layer.succeed(Clock.Clock, Clock.Clock.defaultValue()),
		Layer.succeed(Random.Random, Random.Random.defaultValue()),
		Logger.layer([Logger.consoleStructured]),
	);

export interface GameCore {
	readonly sessionManager: SessionManager;
	readonly port: ISimPort;
}

export interface GameRuntime {
	readonly core: GameCore;
	readonly layer: ReturnType<typeof gameRuntimeLayer>;
	readonly isRunning: () => boolean;
	readonly start: Effect.Effect<void>;
	readonly shutdown: Effect.Effect<void>;
}

export function makeGameRuntime(
	config: GameConfig = DEFAULT_GAME_CONFIG,
): GameRuntime {
	const sessionManager = new SessionManager();
	const port = connectSim(sessionManager);
	let running = false;

	return {
		core: { sessionManager, port },
		layer: gameRuntimeLayer(config),
		isRunning: () => running,
		start: Effect.sync(() => {
			if (running) return;
			sessionManager.incomingOrders.start();
			running = true;
		}),
		shutdown: Effect.sync(() => {
			if (!running) return;
			sessionManager.incomingOrders.stop();
			running = false;
		}),
	};
}
