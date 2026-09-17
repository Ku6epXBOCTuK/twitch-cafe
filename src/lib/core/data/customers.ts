import type { ICustomer } from "../types/customer";

export const CUSTOMER_PRESETS: readonly ICustomer[] = [
	{ id: "easygoing", name: "Голодный", strictness: 0.2 },
	{ id: "normal", name: "Обычный", strictness: 0.5 },
	{ id: "picky", name: "Гурман", strictness: 0.9 },
];
