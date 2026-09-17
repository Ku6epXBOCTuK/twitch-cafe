export interface ITraySnapshot {
	username: string;
	/** Порядок = порядок завершённых put. Только id: SIM не знает IIngredient. */
	layers: string[];
	/** simTime в момент фиксации — для отладки расхождений с таймером. */
	frozenAt: number;
}
