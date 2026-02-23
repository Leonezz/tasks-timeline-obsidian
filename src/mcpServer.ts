// eslint-disable-next-line import/no-nodejs-modules
import http from "node:http";
import { Notice, TFile } from "obsidian";
import { Server } from "@modelcontextprotocol/sdk/server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";
import {
	ListToolsRequestSchema,
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ReadResourceRequestSchema,
	ListPromptsRequestSchema,
	GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types";
import {
	createCapabilities,
	type CapabilityContext,
	type Capabilities,
	type Task,
} from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "./main";
import { ObsidianTasksRepo } from "./tasksRepo";
import { taskToMarkdown } from "./serializers";

/**
 * Creates a CapabilityContext that bridges to Obsidian vault APIs.
 */
function createObsidianContext(
	plugin: TasksTimelineObsidianPlugin,
	tasksRepo: ObsidianTasksRepo,
): CapabilityContext {
	return {
		async getTasks(): Promise<Task[]> {
			return tasksRepo.loadTasks();
		},

		async getTask(id: string): Promise<Task | null> {
			const tasks = await tasksRepo.loadTasks();
			return tasks.find((t) => t.id === id) ?? null;
		},

		async addTask(task: Task): Promise<void> {
			const targetFile =
				task.category ||
				plugin.settings.appSetting.defaultCategory ||
				"Tasks.md";

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

			// Build a minimal template line, then use taskToMarkdown to
			// serialize the full task including priority, tags, and dates.
			const statusMarker = task.status === "done" ? "x" : " ";
			const templateLine = `- [${statusMarker}] ${task.title}`;
			const taskLine = taskToMarkdown(task, templateLine);

			await vault.process(file, (content) => {
				if (content.length > 0 && !content.endsWith("\n")) {
					return content + "\n" + taskLine + "\n";
				}
				return content + taskLine + "\n";
			});

			// Invalidate the file-level cache so subsequent reads see the new task.
			tasksRepo.invalidateFile(targetFile);
		},

		async updateTask(task: Task): Promise<void> {
			// Refresh cache before mutation so task positions are current.
			await tasksRepo.loadTasks();
			await tasksRepo.updateTask(task);
		},

		async deleteTask(id: string): Promise<void> {
			// Refresh cache before mutation so task positions are current.
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
 * over Streamable HTTP transport.
 *
 * Each incoming HTTP request gets its own Server + Transport pair
 * to avoid leaking event listeners across requests (stateless mode).
 */
export class ObsidianMcpServer {
	private plugin: TasksTimelineObsidianPlugin;
	private httpServer: http.Server | null = null;
	private capabilities: Capabilities;

	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;

		const tasksRepo = new ObsidianTasksRepo(plugin);
		const ctx = createObsidianContext(plugin, tasksRepo);
		this.capabilities = createCapabilities(ctx);
	}

	/**
	 * Creates a fresh MCP Server instance with all handlers registered.
	 * Called once per HTTP request to avoid listener accumulation.
	 */
	private createMcpServer(): Server {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
		const server = new Server(
			{
				name: "tasks-timeline-obsidian",
				version: this.plugin.manifest.version,
			},
			{
				capabilities: {
					tools: {},
					resources: {},
					prompts: {},
				},
			},
		);

		this.registerHandlers(server);
		return server;
	}

	private registerHandlers(server: Server): void {
		// --- Tools ---
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		server.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: this.capabilities.tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.schema,
			})),
		}));

		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		server.setRequestHandler(
			CallToolRequestSchema,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			async (request: any) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				const name = request.params.name as string;
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				const args = (request.params.arguments ?? {}) as Record<
					string,
					unknown
				>;
				const tool = this.capabilities.getTool(name);
				if (!tool) {
					throw new Error(`Unknown tool: ${name}`);
				}

				try {
					const result = await tool.execute(args);
					const text =
						typeof result === "string"
							? result
							: JSON.stringify(result);
					return {
						content: [{ type: "text" as const, text }],
					};
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					return {
						content: [{ type: "text" as const, text: message }],
						isError: true,
					};
				}
			},
		);

		// --- Resources ---
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		server.setRequestHandler(ListResourcesRequestSchema, async () => ({
			resources: this.capabilities.resources.map((resource) => ({
				name: resource.name,
				uri: resource.uri,
				description: resource.description,
				mimeType: resource.mimeType,
			})),
		}));

		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		server.setRequestHandler(
			ReadResourceRequestSchema,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			async (request: any) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				const uri = request.params.uri as string;
				const resource = this.capabilities.resources.find(
					(r) => r.uri === uri,
				);
				if (!resource) {
					throw new Error(`Unknown resource: ${uri}`);
				}

				const result = await resource.read();
				return result;
			},
		);

		// --- Prompts ---
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		server.setRequestHandler(ListPromptsRequestSchema, async () => ({
			prompts: this.capabilities.prompts.map((prompt) => ({
				name: prompt.name,
				description: prompt.description,
				arguments: prompt.arguments?.map((arg) => ({
					name: arg.name,
					description: arg.description,
					required: arg.required,
				})),
			})),
		}));

		// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
		server.setRequestHandler(
			GetPromptRequestSchema,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			async (request: any) => {
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				const name = request.params.name as string;
				// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
				const args = request.params.arguments as
					| Record<string, string>
					| undefined;
				const prompt = this.capabilities.getPrompt(name);
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
			},
		);
	}

	async start(): Promise<void> {
		const port = this.plugin.settings.mcpServer.port;

		if (port < 1024 || port > 65535) {
			throw new Error(
				`Invalid MCP server port: ${port}. Must be between 1024 and 65535.`,
			);
		}

		this.httpServer = http.createServer(
			// eslint-disable-next-line @typescript-eslint/no-misused-promises
			async (req: http.IncomingMessage, res: http.ServerResponse) => {
				if (req.url !== "/mcp") {
					res.writeHead(404);
					res.end("Not found");
					return;
				}

				try {
					// Create a fresh Server + Transport per request to avoid
					// accumulating event listeners on a long-lived Server instance.
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const server = this.createMcpServer();
					const transport = new StreamableHTTPServerTransport({
						sessionIdGenerator: undefined,
					});
					// eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
					await server.connect(transport);
					await transport.handleRequest(req, res);
				} catch (error) {
					console.error("MCP request handling error:", error);
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
		if (!this.httpServer) {
			return;
		}

		return new Promise<void>((resolve) => {
			// Prevent new connections, then forcibly close existing ones.
			this.httpServer!.close(() => {
				console.debug("MCP server stopped");
				this.httpServer = null;
				resolve();
			});
			// closeAllConnections() is available in Node 18.2+ (Electron ships Node 18+)
			// but @types/node v16 doesn't declare it.
			const server = this.httpServer as http.Server & {
				closeAllConnections?: () => void;
			};
			server.closeAllConnections?.();
		});
	}
}
