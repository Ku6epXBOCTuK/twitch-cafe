import type { ICustomer } from "./customer";
import type { IMenuItem } from "./menu_item";

export const ORDER_STATUS = {
	PENDING: "PENDING",
	COMPLETED: "COMPLETED",
	EXPIRED: "EXPIRED",
	FAILED: "FAILED",
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export const ORDER_ITEM_STATE = {
	PENDING: "PENDING",
	SEALED: "SEALED",
} as const;
export type OrderItemState =
	(typeof ORDER_ITEM_STATE)[keyof typeof ORDER_ITEM_STATE];

export interface IOrderItem {
	item: IMenuItem;
	state: OrderItemState;
}

export interface IOrder {
	id: string;
	items: IOrderItem[];
	customer: ICustomer;
	timeLimit: number;
	createdAt: Date;
	spawnedAt: Date;
	takenAt: Date | null;
	deadline: number;
	status: OrderStatus;
}
