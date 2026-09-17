import { connectSim } from "../../sim/sync";
import { SessionManager } from "./session-manager";
import type { ISimPort } from "./sim-port";

export interface GameCore {
	sessionManager: SessionManager;
	port: ISimPort;
}

let game: GameCore | null = null;

/** Единственный игровой процесс: SessionManager + SIM. Идемпотентно. */
export function getGame(): GameCore {
	if (game) return game;
	const sessionManager = new SessionManager();
	const port = connectSim(sessionManager);
	sessionManager.incomingOrders.start();
	game = { sessionManager, port };
	return game;
}
