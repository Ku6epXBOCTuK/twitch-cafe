import { STATION_KIND } from "./types";

export const SIM_CONFIG = {
	TICK_HZ: 20,
	SPEED: 0.1,
	START_POINT: { x: 0, y: 0 },
	STATIONS: [
		{ kind: STATION_KIND.SHELF, x: 100, y: 0 },
		{ kind: STATION_KIND.BIN, x: 200, y: 0 },
		{ kind: STATION_KIND.SERVING, x: 300, y: 0 },
	],
} as const;
