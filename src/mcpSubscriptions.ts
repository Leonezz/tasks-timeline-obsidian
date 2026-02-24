import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EventRef } from "obsidian";
import type TasksTimelineObsidianPlugin from "./main";

/**
 * Listens to Obsidian vault events and broadcasts MCP resource notifications
 * to all registered servers. Notifications are debounced (500ms).
 */
export class ResourceSubscriptionManager {
	private plugin: TasksTimelineObsidianPlugin;
	private servers = new Set<McpServer>();
	private eventRefs: EventRef[] = [];
	private updateTimer: ReturnType<typeof setTimeout> | null = null;
	private listChangedTimer: ReturnType<typeof setTimeout> | null = null;

	private static readonly DEBOUNCE_MS = 500;

	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Start listening to vault events. Call once when MCP server starts.
	 */
	start(): void {
		const vault = this.plugin.app.vault;

		this.eventRefs.push(
			vault.on("modify", () => {
				this.debouncedResourceUpdated();
			}),
		);

		this.eventRefs.push(
			vault.on("create", () => {
				this.debouncedResourceListChanged();
			}),
		);

		this.eventRefs.push(
			vault.on("delete", () => {
				this.debouncedResourceListChanged();
			}),
		);

		this.eventRefs.push(
			vault.on("rename", () => {
				this.debouncedResourceListChanged();
			}),
		);
	}

	/**
	 * Stop listening and clean up all timers and event refs.
	 */
	stop(): void {
		for (const ref of this.eventRefs) {
			this.plugin.app.vault.offref(ref);
		}
		this.eventRefs = [];

		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
			this.updateTimer = null;
		}
		if (this.listChangedTimer) {
			clearTimeout(this.listChangedTimer);
			this.listChangedTimer = null;
		}

		this.servers.clear();
	}

	register(server: McpServer): void {
		this.servers.add(server);
	}

	unregister(server: McpServer): void {
		this.servers.delete(server);
	}

	private debouncedResourceUpdated(): void {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
		}
		this.updateTimer = setTimeout(() => {
			this.updateTimer = null;
			this.notifyResourceUpdated();
		}, ResourceSubscriptionManager.DEBOUNCE_MS);
	}

	private debouncedResourceListChanged(): void {
		if (this.listChangedTimer) {
			clearTimeout(this.listChangedTimer);
		}
		this.listChangedTimer = setTimeout(() => {
			this.listChangedTimer = null;
			this.notifyResourceListChanged();
		}, ResourceSubscriptionManager.DEBOUNCE_MS);
	}

	private notifyResourceUpdated(): void {
		for (const server of this.servers) {
			try {
				void server.server.sendResourceUpdated({
					uri: "tasks://all",
				});
			} catch {
				// Transport may be closed
			}
		}
	}

	private notifyResourceListChanged(): void {
		for (const server of this.servers) {
			try {
				server.sendResourceListChanged();
			} catch {
				// Transport may be closed
			}
		}
	}
}
