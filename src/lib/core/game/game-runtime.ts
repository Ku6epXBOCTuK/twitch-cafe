import { Clock, Effect, Exit, Layer, Logger, Random, Scope } from "effect";
import { connectSim } from "../../sim/sync";
import { DEFAULT_GAME_CONFIG, GameConfig } from "./game-config";
import { SessionManager } from "./session-manager";
import type { ISimPort } from "./sim-port";

export { DEFAULT_GAME_CONFIG, GameConfig } from "./game-config";

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
	const sessionManager = new SessionManager(undefined, config);
	const port = connectSim(sessionManager);
	let running = false;
	let runtimeScope: Scope.Closeable | null = null;

	const start = Effect.gen(function* () {
		if (running) return;
		const scope = yield* Scope.make();
		yield* Scope.provide(scope)(
			Effect.provideService(
				Effect.provideService(
					sessionManager.incomingOrders.startEffect(),
					GameConfig,
					config,
				),
				Clock.Clock,
				Clock.Clock.defaultValue(),
			),
		);
		runtimeScope = scope;
		running = true;
	});

	const shutdown = Effect.gen(function* () {
		if (!running) return;
		yield* sessionManager.incomingOrders.stopEffect();
		const scope = runtimeScope;
		runtimeScope = null;
		running = false;
		if (scope) yield* Scope.close(scope, Exit.void);
	});

	return {
		core: { sessionManager, port },
		layer: gameRuntimeLayer(config),
		isRunning: () => running,
		start,
		shutdown,
	};
}
