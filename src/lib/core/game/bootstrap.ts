import { Effect } from "effect";
import {
	makeGameRuntime,
	type GameCore,
	type GameRuntime,
} from "./game-runtime";

let runtime: GameRuntime | null = null;

export function getGameRuntime(): GameRuntime {
	if (runtime) return runtime;
	const created = makeGameRuntime();
	Effect.runSync(created.start);
	runtime = created;
	return created;
}

export function getGame(): GameCore {
	return getGameRuntime().core;
}

export function shutdownGame(): void {
	if (!runtime) return;
	Effect.runSync(runtime.shutdown);
	runtime = null;
}
