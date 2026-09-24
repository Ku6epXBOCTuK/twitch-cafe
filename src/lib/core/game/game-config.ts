import { Context } from "effect";
import { ORDER_CONFIG } from "../config";

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
