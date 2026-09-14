import type { ICustomer } from "./customer";
import type { IMenuItem } from "./menu_item";

export const ORDER_STATUS = {
	PENDING: "PENDING",
	COMPLETED: "COMPLETED",
	EXPIRED: "EXPIRED",
	FAILED: "FAILED",
} as const;
export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export interface IOrder {
	id: string;
	items: IMenuItem[];
	customer: ICustomer;
	timeLimit: number;
	createdAt: Date;
	status: OrderStatus;
}
