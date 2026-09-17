export interface IncomingOrder {
	id: string;
	dishes: string[];
	strictness: number;
	/** срок выполнения, epoch ms */
	deadline: number;
}

export interface ExecutionDish {
	name: string;
	done: boolean;
}

export interface ExecutionOrder {
	id: string;
	performer: string;
	dishes: ExecutionDish[];
	/** срок выполнения, epoch ms */
	deadline: number;
}

export interface RecipeCard {
	id: string;
	name: string;
	ingredients: string[];
}

export interface OverlaySnapshot {
	incoming: IncomingOrder[];
	execution: ExecutionOrder[];
	recipe: RecipeCard | null;
}
