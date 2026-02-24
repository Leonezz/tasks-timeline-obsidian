/**
 * Per-tool usage statistics with debounced persistence.
 */

export interface ToolStats {
	total: number;
	successful: number;
	failed: number;
}

export type StatsData = Record<string, ToolStats>;

const DEBOUNCE_MS = 5000;

export class StatsTracker {
	private stats: StatsData = {};
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private persistFn: (stats: StatsData) => Promise<void>;

	constructor(
		initialStats: StatsData,
		persistFn: (stats: StatsData) => Promise<void>,
	) {
		this.stats = { ...initialStats };
		this.persistFn = persistFn;
	}

	recordSuccess(toolName: string): void {
		const prev = this.stats[toolName] ?? {
			total: 0,
			successful: 0,
			failed: 0,
		};
		this.stats = {
			...this.stats,
			[toolName]: {
				total: prev.total + 1,
				successful: prev.successful + 1,
				failed: prev.failed,
			},
		};
		this.schedulePersist();
	}

	recordFailure(toolName: string): void {
		const prev = this.stats[toolName] ?? {
			total: 0,
			successful: 0,
			failed: 0,
		};
		this.stats = {
			...this.stats,
			[toolName]: {
				total: prev.total + 1,
				successful: prev.successful,
				failed: prev.failed + 1,
			},
		};
		this.schedulePersist();
	}

	getStats(): Readonly<StatsData> {
		return this.stats;
	}

	/**
	 * Immediately persists current stats and cancels any pending debounce.
	 * Call this on plugin unload.
	 */
	async flush(): Promise<void> {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		await this.persistFn(this.stats);
	}

	private schedulePersist(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			void this.persistFn(this.stats);
		}, DEBOUNCE_MS);
	}
}
