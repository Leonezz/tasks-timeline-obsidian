import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type LogLevel = "debug" | "info" | "warning" | "error";

/**
 * Broadcasts MCP logging messages to all registered McpServer instances.
 * Gracefully catches errors from closed transports.
 */
export class McpLogger {
	private servers = new Set<McpServer>();

	register(server: McpServer): void {
		this.servers.add(server);
	}

	unregister(server: McpServer): void {
		this.servers.delete(server);
	}

	clear(): void {
		this.servers.clear();
	}

	log(level: LogLevel, data: unknown, logger?: string): void {
		for (const server of this.servers) {
			try {
				void server.sendLoggingMessage({
					level,
					data,
					logger: logger ?? "tasks-timeline-mcp",
				});
			} catch {
				// Transport may be closed — ignore
			}
		}
	}

	debug(data: unknown, logger?: string): void {
		this.log("debug", data, logger);
	}

	info(data: unknown, logger?: string): void {
		this.log("info", data, logger);
	}

	warning(data: unknown, logger?: string): void {
		this.log("warning", data, logger);
	}

	error(data: unknown, logger?: string): void {
		this.log("error", data, logger);
	}
}
