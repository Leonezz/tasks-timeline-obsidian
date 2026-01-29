export type Events = {
	"system:themeChange": { isDarkMode: boolean };
};

export class TypedBus<E extends Record<string, unknown>> {
	private map: { [K in keyof E]?: Set<(p: E[K]) => void> } = {};

	on<K extends keyof E>(event: K, cb: (payload: E[K]) => void) {
		console.debug("on: ", event);
		(this.map[event] ||= new Set()).add(cb);
		return () => this.off(event, cb);
	}

	off<K extends keyof E>(event: K, cb: (payload: E[K]) => void) {
		console.debug("off: ", event);
		const set = this.map[event];
		if (!set) return;
		set.delete(cb);
		if (set.size === 0) delete this.map[event];
	}

	emit<K extends keyof E>(event: K, payload: E[K]) {
		const call = (set?: Set<(p: E[K]) => void>) =>
			set?.forEach((fn) => {
				try {
					fn(payload);
				} catch (e) {
					console.error(`Event handler for ${String(event)} threw:`, e);
				}
			});
		console.debug("emit: ", event, ", listeners: ", this.map[event]?.size);
		call(this.map[event]);
		// naive wildcard match: prefix + ':*'
		const star = (String(event).split(":")[0] + ":*") as keyof E;
		call(this.map[star]);
	}
}
