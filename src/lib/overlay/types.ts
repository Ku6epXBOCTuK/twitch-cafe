export interface OverlayBoardSlot {
	id: string;
	label: string;
}

export interface OverlaySnapshot {
	incoming: OverlayBoardSlot[];
	execution: OverlayBoardSlot[];
	recipe: OverlayBoardSlot | null;
}
