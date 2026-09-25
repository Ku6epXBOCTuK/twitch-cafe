import { ACTION_KIND } from "../core/game/sim-dto";
import type { EntityId, IngredientId } from "../core/game/sim-dto";

export const STATION_KIND = {
	SHELF: "shelf",
	BIN: "bin",
	SERVING: "serving",
} as const;
export type StationKind = (typeof STATION_KIND)[keyof typeof STATION_KIND];

export const SIM_ENTITY_KIND = {
	CHEF: "chef",
	STATION: "station",
	TRAY: "tray",
} as const;
export type SimEntityKind =
	(typeof SIM_ENTITY_KIND)[keyof typeof SIM_ENTITY_KIND];

export interface TransformComponent {
	x: number;
	y: number;
	facing: number;
}

export interface ChefComponent {
	username: string;
}

export interface StationComponent {
	kind: StationKind;
}

export interface TrayComponent {
	username: string;
	layers: string[];
}

export interface CarriesComponent {
	trayId: EntityId;
}

export interface CarriedByComponent {
	carrierId: EntityId;
}

export interface OrderComponent {
	orderId: string;
}

export type ActionComponent =
	| {
			kind: typeof ACTION_KIND.PUT;
			ingredientId: IngredientId;
			targetId: EntityId;
			startedAt: number;
	  }
	| {
			kind: typeof ACTION_KIND.BIN;
			targetId: EntityId;
			startedAt: number;
	  }
	| {
			kind: typeof ACTION_KIND.SERVE;
			targetId: EntityId;
			startedAt: number;
	  };

export interface SimEntity {
	meta?: { kind: SimEntityKind };
	chef?: ChefComponent;
	station?: StationComponent;
	tray?: TrayComponent;
	carries?: CarriesComponent;
	carriedBy?: CarriedByComponent;
	order?: OrderComponent;
	transform?: TransformComponent;
	action?: ActionComponent;
}
