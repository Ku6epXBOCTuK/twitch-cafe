export interface GameMetricsSnapshot {
	readonly commands: number;
	readonly failures: number;
	readonly queueDepth: number;
	readonly activeSessions: number;
	readonly timerCount: number;
}

export class GameMetrics {
	private commandCount = 0;
	private failureCount = 0;

	recordCommand(): void {
		this.commandCount += 1;
	}

	recordFailure(): void {
		this.failureCount += 1;
	}

	read(
		queueDepth: number,
		activeSessions: number,
		timerCount: number,
	): GameMetricsSnapshot {
		return {
			commands: this.commandCount,
			failures: this.failureCount,
			queueDepth,
			activeSessions,
			timerCount,
		};
	}
}
