import http from "node:http";
import crypto from "node:crypto";
import { Notice, TFile } from "obsidian";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
	createCapabilities,
	type CapabilityContext,
	type Capabilities,
	type PromptSpec,
	type Task,
} from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "./main";
import { ObsidianTasksRepo } from "./tasksRepo";
import { taskToMarkdown } from "./serializers";
import { TOOL_ANNOTATIONS, generateResultAnnotations } from "./mcpAnnotations";
import type { McpAuthManager } from "./mcpAuth";
import type { StatsTracker } from "./mcpStats";
import { SecurityManager } from "./mcpSecurity";
import { McpLogger } from "./mcpLogger";
import { ResourceSubscriptionManager } from "./mcpSubscriptions";
import { createObsidianPrompts } from "./mcpPrompts";

// --- Session types ---

interface SessionToolStats {
	calls: number;
	errors: number;
}

interface McpSession {
	id: string;
	server: McpServer;
	transport: StreamableHTTPServerTransport;
	clientInfo?: { name: string; version: string };
	connectedAt: number;
	lastAccessAt: number;
	toolStats: Record<string, SessionToolStats>;
}

export interface SessionSummary {
	sessionId: string;
	clientName: string;
	clientVersion: string;
	connectedAt: number;
	lastActiveAt: number;
	durationSeconds: number;
	toolCalls: {
		total: number;
		successful: number;
		failed: number;
		byTool: Record<string, { calls: number; errors: number }>;
	};
}

// --- Constants ---

const MAX_SESSIONS = 10;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Creates a CapabilityContext that bridges to Obsidian vault APIs.
 * Applies security filtering when a SecurityManager is provided.
 */
function createObsidianContext(
	plugin: TasksTimelineObsidianPlugin,
	tasksRepo: ObsidianTasksRepo,
	securityManager?: SecurityManager,
): CapabilityContext {
	return {
		async getTasks(): Promise<Task[]> {
			const tasks = await tasksRepo.loadTasks();
			return securityManager ? securityManager.filterTasks(tasks) : tasks;
		},

		async getTask(id: string): Promise<Task | null> {
			const tasks = await tasksRepo.loadTasks();
			const task = tasks.find((t) => t.id === id) ?? null;
			if (
				task &&
				securityManager &&
				!securityManager.isTaskAllowed(task)
			) {
				return null;
			}
			return task;
		},

		async addTask(task: Task): Promise<void> {
			const targetFile =
				task.category ||
				plugin.settings.appSetting.defaultCategory ||
				"Tasks.md";

			// Check path against security blacklist
			if (securityManager && !securityManager.isPathAllowed(targetFile)) {
				throw new Error(
					`Cannot add task: path is blocked by security rules: ${targetFile}`,
				);
			}

			const vault = plugin.app.vault;
			let file = vault.getAbstractFileByPath(targetFile);

			if (!file) {
				file = await vault.create(targetFile, "");
			}

			if (!(file instanceof TFile)) {
				throw new Error(
					`Cannot add task: path is not a file: ${targetFile}`,
				);
			}

			const statusMarker = task.status === "done" ? "x" : " ";
			const templateLine = `- [${statusMarker}] ${task.title}`;
			const taskLine = taskToMarkdown(task, templateLine);

			await vault.process(file, (content) => {
				if (content.length > 0 && !content.endsWith("\n")) {
					return content + "\n" + taskLine + "\n";
				}
				return content + taskLine + "\n";
			});

			tasksRepo.invalidateFile(targetFile);
		},

		async updateTask(task: Task): Promise<void> {
			await tasksRepo.loadTasks();
			await tasksRepo.updateTask(task);
		},

		async deleteTask(id: string): Promise<void> {
			await tasksRepo.loadTasks();
			await tasksRepo.deleteTask(id);
		},

		getSettings() {
			return plugin.settings.appSetting;
		},

		notify(_type: "success" | "error" | "info", message: string) {
			new Notice(message);
		},
	};
}

/**
 * Manages an MCP server that exposes Obsidian task capabilities
 * over Streamable HTTP transport with session management, authentication,
 * stats tracking, security filtering, logging, and resource subscriptions.
 */
export class ObsidianMcpServer {
	private plugin: TasksTimelineObsidianPlugin;
	private httpServer: http.Server | null = null;
	private capabilities: Capabilities;
	private obsidianPrompts: PromptSpec[] = [];
	private sessions = new Map<string, McpSession>();
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;

	// Injected dependencies
	private authManager: McpAuthManager | null = null;
	private statsTracker: StatsTracker | null = null;
	private securityManager: SecurityManager;
	private logger = new McpLogger();
	private subscriptionManager: ResourceSubscriptionManager;

	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;

		this.securityManager = new SecurityManager();
		this.securityManager.updateRules(
			plugin.settings.mcpServer.blacklist ?? "",
		);

		const tasksRepo = new ObsidianTasksRepo(plugin);
		const ctx = createObsidianContext(
			plugin,
			tasksRepo,
			this.securityManager,
		);
		this.capabilities = createCapabilities(ctx);
		this.obsidianPrompts = createObsidianPrompts(ctx);

		this.subscriptionManager = new ResourceSubscriptionManager(plugin);
	}

	setAuthManager(manager: McpAuthManager): void {
		this.authManager = manager;
	}

	setStatsTracker(tracker: StatsTracker): void {
		this.statsTracker = tracker;
	}

	getSecurityManager(): SecurityManager {
		return this.securityManager;
	}

	getLogger(): McpLogger {
		return this.logger;
	}

	/**
	 * Returns summaries of all active sessions for the settings UI and
	 * the list_sessions tool.
	 */
	getSessionSummaries(): SessionSummary[] {
		const now = Date.now();
		const summaries: SessionSummary[] = [];

		for (const session of this.sessions.values()) {
			let totalCalls = 0;
			let totalErrors = 0;
			const byTool: Record<string, { calls: number; errors: number }> =
				{};

			for (const [tool, stats] of Object.entries(session.toolStats)) {
				totalCalls += stats.calls;
				totalErrors += stats.errors;
				byTool[tool] = { ...stats };
			}

			summaries.push({
				sessionId: session.id.slice(-8),
				clientName: session.clientInfo?.name ?? "unknown",
				clientVersion: session.clientInfo?.version ?? "unknown",
				connectedAt: session.connectedAt,
				lastActiveAt: session.lastAccessAt,
				durationSeconds: Math.floor((now - session.connectedAt) / 1000),
				toolCalls: {
					total: totalCalls,
					successful: totalCalls - totalErrors,
					failed: totalErrors,
					byTool,
				},
			});
		}

		return summaries;
	}

	/**
	 * Creates a fresh McpServer instance with all handlers registered.
	 * The sessionId is captured in handler closures for per-session stats.
	 */
	private createMcpServer(sessionId: string): McpServer {
		const subscriptionsEnabled =
			this.plugin.settings.mcpServer.subscriptionsEnabled ?? false;

		const mcpServer = new McpServer(
			{
				name: "tasks-timeline-obsidian",
				version: this.plugin.manifest.version,
			},
			{
				capabilities: {
					tools: {},
					resources: subscriptionsEnabled ? { subscribe: true } : {},
					prompts: {},
					logging: {},
				},
			},
		);

		this.registerHandlers(mcpServer, sessionId);
		return mcpServer;
	}

	private registerHandlers(mcpServer: McpServer, sessionId: string): void {
		const server = mcpServer.server;

		// --- Tools ---
		server.setRequestHandler(ListToolsRequestSchema, async () => {
			const tools = this.capabilities.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.schema,
				annotations: TOOL_ANNOTATIONS[tool.name],
			}));

			// Add the custom list_sessions tool
			tools.push({
				name: "list_sessions",
				description:
					"List all active MCP sessions with client info and per-session tool usage stats.",
				inputSchema: { type: "object", properties: {} },
				annotations: TOOL_ANNOTATIONS["list_sessions"],
			});

			return { tools };
		});

		server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const name = request.params.name;
			const args = request.params.arguments ?? {};

			// Handle custom list_sessions tool
			if (name === "list_sessions") {
				const summaries = this.getSessionSummaries();
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(summaries, null, 2),
						},
					],
					structuredContent: summaries,
				};
			}

			const tool = this.capabilities.getTool(name);
			if (!tool) {
				throw new Error(`Unknown tool: ${name}`);
			}

			this.logger.info(`Executing tool: ${name}`, "tool-execution");

			try {
				const result = await tool.execute(args);
				const text =
					typeof result === "string"
						? result
						: JSON.stringify(result);

				// Record stats
				this.statsTracker?.recordSuccess(name);
				this.recordSessionToolCall(sessionId, name, true);

				// Build response content
				const content: Array<{ type: "text"; text: string }> = [
					{ type: "text" as const, text },
				];

				// Append smart annotations (Task 9)
				const annotations = generateResultAnnotations(name, result);
				for (const ann of annotations) {
					content.push(ann);
				}

				// Structured content (Task 10)
				const response: Record<string, unknown> = { content };
				if (typeof result !== "string") {
					response.structuredContent = result;
				}

				return response;
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);

				// Record stats
				this.statsTracker?.recordFailure(name);
				this.recordSessionToolCall(sessionId, name, false);

				this.logger.error(
					`Tool ${name} failed: ${message}`,
					"tool-execution",
				);

				return {
					content: [{ type: "text" as const, text: message }],
					isError: true,
				};
			}
		});

		// --- Resources ---
		server.setRequestHandler(ListResourcesRequestSchema, async () => ({
			resources: this.capabilities.resources.map((resource) => ({
				name: resource.name,
				uri: resource.uri,
				description: resource.description,
				mimeType: resource.mimeType,
			})),
		}));

		server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
			const uri = request.params.uri;
			const resource = this.capabilities.resources.find(
				(r) => r.uri === uri,
			);
			if (!resource) {
				throw new Error(`Unknown resource: ${uri}`);
			}

			const result = await resource.read();
			return { contents: result.contents };
		});

		// --- Prompts ---
		server.setRequestHandler(ListPromptsRequestSchema, async () => {
			const allPrompts = [
				...this.capabilities.prompts,
				...this.obsidianPrompts,
			];
			return {
				prompts: allPrompts.map((prompt) => ({
					name: prompt.name,
					description: prompt.description,
					arguments: prompt.arguments?.map((arg) => ({
						name: arg.name,
						description: arg.description,
						required: arg.required,
					})),
				})),
			};
		});

		server.setRequestHandler(GetPromptRequestSchema, async (request) => {
			const name = request.params.name;
			const args = request.params.arguments;
			const prompt =
				this.capabilities.getPrompt(name) ??
				this.obsidianPrompts.find((p) => p.name === name);
			if (!prompt) {
				throw new Error(`Unknown prompt: ${name}`);
			}

			const messages = await prompt.render(args);
			return {
				messages: messages.map((msg) => ({
					role: msg.role,
					content: {
						type: "text" as const,
						text: msg.content,
					},
				})),
			};
		});
	}

	private recordSessionToolCall(
		sessionId: string,
		toolName: string,
		success: boolean,
	): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		const prev = session.toolStats[toolName] ?? { calls: 0, errors: 0 };
		session.toolStats = {
			...session.toolStats,
			[toolName]: {
				calls: prev.calls + 1,
				errors: success ? prev.errors : prev.errors + 1,
			},
		};
	}

	private createSession(): McpSession {
		const sessionId = crypto.randomUUID();
		const server = this.createMcpServer(sessionId);
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => sessionId,
		});

		const session: McpSession = {
			id: sessionId,
			server,
			transport,
			connectedAt: Date.now(),
			lastAccessAt: Date.now(),
			toolStats: {},
		};

		// Evict oldest session if at capacity
		if (this.sessions.size >= MAX_SESSIONS) {
			let oldestKey: string | null = null;
			let oldestAccess = Infinity;
			for (const [key, s] of this.sessions) {
				if (s.lastAccessAt < oldestAccess) {
					oldestAccess = s.lastAccessAt;
					oldestKey = key;
				}
			}
			if (oldestKey) {
				this.closeSession(oldestKey);
			}
		}

		this.sessions.set(sessionId, session);

		// Register server with logger and subscriptions
		this.logger.register(session.server);
		if (this.plugin.settings.mcpServer.subscriptionsEnabled) {
			this.subscriptionManager.register(session.server);
		}

		this.logger.info(
			`New session created: ${sessionId.slice(-8)}`,
			"session",
		);

		return session;
	}

	private closeSession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) return;

		this.logger.unregister(session.server);
		this.subscriptionManager.unregister(session.server);

		try {
			void session.server.close();
		} catch {
			// Already closed
		}
		try {
			void session.transport.close();
		} catch {
			// Already closed
		}

		this.sessions.delete(sessionId);
		this.logger.info(`Session closed: ${sessionId.slice(-8)}`, "session");
	}

	private cleanupExpiredSessions(): void {
		const now = Date.now();
		for (const [id, session] of this.sessions) {
			if (now - session.lastAccessAt > SESSION_TTL_MS) {
				this.closeSession(id);
			}
		}
	}

	async start(): Promise<void> {
		const port = this.plugin.settings.mcpServer.port;

		if (port < 1024 || port > 65535) {
			throw new Error(
				`Invalid MCP server port: ${port}. Must be between 1024 and 65535.`,
			);
		}

		// Start resource subscriptions if enabled
		if (this.plugin.settings.mcpServer.subscriptionsEnabled) {
			this.subscriptionManager.start();
		}

		// Start session cleanup interval
		this.cleanupInterval = setInterval(() => {
			this.cleanupExpiredSessions();
		}, CLEANUP_INTERVAL_MS);

		this.httpServer = http.createServer(
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			async (req: http.IncomingMessage, res: http.ServerResponse) => {
				if (req.url !== "/mcp") {
					res.writeHead(404);
					res.end("Not found");
					return;
				}

				// --- Auth middleware ---
				const authEnabled =
					this.plugin.settings.mcpServer.authEnabled ?? true;
				if (authEnabled && this.authManager) {
					const authHeader = req.headers["authorization"];
					if (!authHeader) {
						res.writeHead(401, {
							"Content-Type": "application/json",
						});
						res.end(
							JSON.stringify({
								error: "Authorization header required",
							}),
						);
						this.logger.warning(
							"Auth failed: missing Authorization header",
							"auth",
						);
						return;
					}

					const token = authHeader.replace(/^Bearer\s+/i, "");
					const valid = await this.authManager.validateToken(token);
					if (!valid) {
						res.writeHead(403, {
							"Content-Type": "application/json",
						});
						res.end(JSON.stringify({ error: "Invalid token" }));
						this.logger.warning(
							"Auth failed: invalid token",
							"auth",
						);
						return;
					}
				}

				try {
					// Session management
					const sessionIdHeader = req.headers["mcp-session-id"] as
						| string
						| undefined;

					if (req.method === "DELETE" && sessionIdHeader) {
						// Close session
						this.closeSession(sessionIdHeader);
						res.writeHead(200);
						res.end();
						return;
					}

					if (sessionIdHeader) {
						// Existing session
						const session = this.sessions.get(sessionIdHeader);
						if (!session) {
							res.writeHead(404, {
								"Content-Type": "application/json",
							});
							res.end(
								JSON.stringify({
									error: "Session not found",
								}),
							);
							return;
						}

						session.lastAccessAt = Date.now();
						await session.transport.handleRequest(req, res);
					} else {
						// New session (initialize)
						const session = this.createSession();
						await session.server.connect(session.transport);
						await session.transport.handleRequest(req, res);
					}
				} catch (error) {
					console.error("MCP request handling error:", error);
					this.logger.error(
						`Request handling error: ${error instanceof Error ? error.message : String(error)}`,
						"http",
					);
					if (!res.headersSent) {
						res.writeHead(500);
						res.end("Internal server error");
					}
				}
			},
		);

		return new Promise<void>((resolve, reject) => {
			this.httpServer!.on("error", (err) => {
				reject(err);
			});

			this.httpServer!.listen(port, "127.0.0.1", () => {
				console.debug(
					`MCP server listening on http://127.0.0.1:${port}/mcp`,
				);
				new Notice(`MCP server started on port ${port}`);
				resolve();
			});
		});
	}

	async stop(): Promise<void> {
		// Stop subscription manager
		this.subscriptionManager.stop();

		// Stop cleanup interval
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Close all sessions
		for (const id of [...this.sessions.keys()]) {
			this.closeSession(id);
		}

		// Clear logger
		this.logger.clear();

		if (!this.httpServer) {
			return;
		}

		return new Promise<void>((resolve) => {
			this.httpServer!.close(() => {
				console.debug("MCP server stopped");
				this.httpServer = null;
				resolve();
			});
			const server = this.httpServer as http.Server & {
				closeAllConnections?: () => void;
			};
			server.closeAllConnections?.();
		});
	}
}
