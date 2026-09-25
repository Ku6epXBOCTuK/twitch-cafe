import { World } from "miniplex";
import { SIM_CONFIG } from "./config";
import { SIM_ENTITY_KIND, type SimEntity } from "./types";
import type { StationKind } from "./types";

export type SimWorld = World<SimEntity>;

export interface PlayerEntities {
	player: SimEntity;
	tray: SimEntity;
}

export function createWorld(): SimWorld {
	const world = new World<SimEntity>();
	for (const station of SIM_CONFIG.STATIONS) {
		world.add({
			meta: { kind: SIM_ENTITY_KIND.STATION },
			station: { kind: station.kind },
			transform: { x: station.x, y: station.y, facing: 0 },
		});
	}
	return world;
}

export function spawnPlayer(
	world: SimWorld,
	username: string,
	orderId: string,
): PlayerEntities {
	const tray: SimEntity = {
		meta: { kind: SIM_ENTITY_KIND.TRAY },
		tray: { username, layers: [] },
	};
	world.add(tray);
	const player: SimEntity = {
		meta: { kind: SIM_ENTITY_KIND.CHEF },
		chef: { username },
		order: { orderId },
		transform: { ...SIM_CONFIG.START_POINT, facing: 0 },
		carries: { trayId: world.id(tray)! },
	};
	world.add(player);
	world.update(tray, { carriedBy: { carrierId: world.id(player)! } });
	return { player, tray };
}

export function removePlayer(world: SimWorld, entities: PlayerEntities): void {
	world.remove(entities.player);
	world.remove(entities.tray);
}

export function findStation(
	world: SimWorld,
	kind: StationKind,
): SimEntity | undefined {
	for (const station of world.with("station")) {
		if (station.station?.kind === kind) return station;
	}
	return undefined;
}
