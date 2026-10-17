import { Notice } from "obsidian";
import {
	createCapabilities,
	type Capabilities,
	type CapabilityContext,
	type Task,
	type ToolSpec,
} from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "./main";
import { SecurityManager } from "./mcpSecurity";
import { StaleTaskError, taskLineVersion } from "./taskLine";
import { ObsidianTasksRepo, taskUpdateNeedsWrite } from "./tasksRepo";

function getTaskTargetPath(
	plugin: TasksTimelineObsidianPlugin,
	task: Task,
	existingTask?: Task,
): string {
	return (
		task.category ||
		existingTask?.category ||
		task.extra?.file ||
		existingTask?.extra?.file ||
		plugin.settings.appSetting.defaultCategory ||
		"Tasks.md"
	);
}

function assertAllowedPath(
	securityManager: SecurityManager | undefined,
	path: string,
	action: string,
): void {
	if (securityManager && !securityManager.isPathAllowed(path)) {
		throw new Error(
			`Cannot ${action}: path is blocked by security rules: ${path}`,
		);
	}
}

function assertAllowedTask(
	securityManager: SecurityManager | undefined,
	task: Task,
	action: string,
): void {
	if (securityManager && !securityManager.isTaskAllowed(task)) {
		throw new Error(
			`Cannot ${action}: task is blocked by security rules: ${task.id}`,
		);
	}
}

export interface ObsidianCapabilityContext extends CapabilityContext {
	/** Stops watching the vault. Call when the MCP server stops. */
	dispose(): void;
	/**
	 * Why complete_task can't follow the recurrence rule of the open task
	 * `id`, and how to fix the note, when the rule is one v0.8.0 split over
	 * two lines and the task was read without the second; else undefined.
	 */
	splitRuleFix(id: string): Promise<string | undefined>;
}

/**
 * Ids handed to MCP clients carry the version of the task line they were
 * issued for: `<file>:<line>:<col>~<version>`. A repository id is a line
 * position shared by every MCP session, so once the note changes the same
 * position can name another task, and any later read (another tool, a
 * resource, a prompt, another session) would otherwise re-bind an id a
 * client still holds to that task.
 */
const ISSUED_ID = /^(.+:\d+:\d+)~([0-9a-z]+)$/;

function issue(task: Task): Task {
	const rawText = task.extra?.rawText;
	return rawText
		? { ...task, id: `${task.id}~${taskLineVersion(rawText)}` }
		: task;
}

function parseIssuedId(id: string): { repoId: string; version: string } {
	const match = id.match(ISSUED_ID);
	if (!match?.[1] || !match[2]) {
		throw new Error(
			`Unknown task id ${id}: use an id from query_tasks or a tasks:// resource.`,
		);
	}
	return { repoId: match[1], version: match[2] };
}

/**
 * Creates the headless task capability context used by the MCP server.
 *
 * The Obsidian repository stays responsible for persistence. This adapter owns
 * policy checks and host UI feedback so every AI surface uses the same task
 * semantics.
 *
 * Unlike the timeline view, nothing reloads this repository on vault events,
 * so it watches the vault itself: listings then reflect edits made in
 * Obsidian. Single-task reads re-read the note and refuse ids whose line
 * changed since they were listed, because an id is a line position and may
 * by then name a different task.
 */
export function createObsidianCapabilityContext(
	plugin: TasksTimelineObsidianPlugin,
	securityManager?: SecurityManager,
): ObsidianCapabilityContext {
	const tasksRepo = new ObsidianTasksRepo(plugin);
	const stopWatching = tasksRepo.watchVault();
	/** Versions this server's own writes replaced: `<repoId>~<old>` → new. */
	const supersededBy = new Map<string, string>();

	/** Whether `version`, or a version this server's writes made from it, is current. */
	const isCurrent = (repoId: string, version: string, current: string) => {
		const seen = new Set<string>();
		let candidate: string | undefined = version;
		while (candidate !== undefined && !seen.has(candidate)) {
			if (candidate === current) return true;
			seen.add(candidate);
			candidate = supersededBy.get(`${repoId}~${candidate}`);
		}
		return false;
	};

	/** The task an issued id names, refusing it if its line changed since. */
	const readIssued = async (id: string): Promise<Task> => {
		const { repoId, version } = parseIssuedId(id);
		let task: Task | null;
		try {
			task = await tasksRepo.getTask(repoId);
		} catch (error) {
			throw error instanceof StaleTaskError ? new StaleTaskError(id) : error;
		}
		const rawText = task?.extra?.rawText;
		if (
			!task ||
			!rawText ||
			!isCurrent(repoId, version, taskLineVersion(rawText))
		) {
			throw new StaleTaskError(id);
		}
		return task;
	};

	const getTask = async (id: string): Promise<Task | null> => {
		const task = await readIssued(id);
		if (securityManager && !securityManager.isTaskAllowed(task)) {
			return null;
		}
		return issue(task);
	};

	return {
		async getTasks(): Promise<Task[]> {
			const tasks = await tasksRepo.loadTasks();
			const allowed = securityManager
				? securityManager.filterTasks(tasks)
				: tasks;
			return allowed.map(issue);
		},

		getTask,

		async splitRuleFix(id: string): Promise<string | undefined> {
			const task = await getTask(id);
			if (
				!task ||
				task.status === "done" ||
				!task.recurringInterval?.startsWith("DTSTART")
			) {
				return undefined;
			}
			return tasksRepo.splitRuleFix(parseIssuedId(id).repoId);
		},

		async addTask(task: Task): Promise<Task> {
			const targetPath = getTaskTargetPath(plugin, task);
			assertAllowedPath(securityManager, targetPath, "add task");
			assertAllowedTask(securityManager, task, "add task");

			// Return the stored task: its id comes from the file position, so
			// create_task must report it instead of its own temporary id.
			return issue(await tasksRepo.addTask(task));
		},

		async updateTask(task: Task): Promise<void> {
			const { repoId, version } = parseIssuedId(task.id);
			const existingTask = await readIssued(task.id);
			const repoTask = { ...task, id: repoId };

			const targetPath = getTaskTargetPath(plugin, repoTask, existingTask);
			assertAllowedTask(securityManager, existingTask, "update task");
			assertAllowedPath(securityManager, targetPath, "update task");
			assertAllowedTask(securityManager, repoTask, "update task");

			// Throws for changes the line cannot store (description, category,
			// frontmatter tags) instead of reporting success for a no-op.
			if (!taskUpdateNeedsWrite(repoTask, existingTask)) {
				return;
			}
			const written = taskLineVersion(
				await tasksRepo.writeTaskLine(repoTask),
			);
			// The client's id stays usable for this task after our own write.
			if (written !== version) {
				supersededBy.set(`${repoId}~${version}`, written);
			}
		},

		async deleteTask(id: string): Promise<void> {
			const { repoId } = parseIssuedId(id);
			const existingTask = await readIssued(id);

			const targetPath = getTaskTargetPath(plugin, existingTask);
			assertAllowedTask(securityManager, existingTask, "delete task");
			assertAllowedPath(securityManager, targetPath, "delete task");

			await tasksRepo.deleteTask(repoId);
		},

		getSettings() {
			return plugin.settings.appSetting;
		},

		notify(_type: "success" | "error" | "info", message: string) {
			new Notice(message);
		},

		// This context is headless (used by the MCP server) and has no
		// `confirm` UI. External MCP clients run their own tool-approval flow,
		// and the security manager still filters paths and tags, so destructive
		// tools (delete_task, batch_update_tasks) proceed instead of being
		// refused. The in-app agent builds its own context
		// with a `confirm` dialog inside the component library.
		confirmPolicy: "skip",

		// Tasks are Obsidian Tasks lines: create_task, update_task and
		// batch_update_tasks store rules as Tasks text and reject rules a line
		// can't hold (DTSTART, BYSETPOS) before writing anything. Counts are
		// rejected by createObsidianCapabilities.
		recurrenceFormat: "text",

		dispose: stopWatching,
	};
}

/** The `recurrence` argument each rule-writing tool takes. */
const RULE_ARGUMENTS: Record<
	string,
	(args: Record<string, unknown>) => unknown
> = {
	create_task: (args) => args.recurrence,
	update_task: (args) => args.recurrence,
	batch_update_tasks: (args) =>
		typeof args.update === "object" && args.update !== null
			? (args.update as Record<string, unknown>).recurrence
			: undefined,
};

/** A COUNT part of an RRULE ("FREQ=WEEKLY;COUNT=3"). */
const COUNT_PART = /(?:^|[;:\s])COUNT\s*=/i;

/**
 * Why a task line can't hold `recurrence`, when it is an RRULE with COUNT.
 * With recurrenceFormat "text" the library writes COUNT as "for 3 times",
 * and every completion copies that text to the next occurrence, so the
 * count starts again and the rule never ends. The library refuses the same
 * rule given as text; this refuses it as RRULE.
 */
function countRejection(recurrence: unknown): string | undefined {
	if (typeof recurrence !== "string" || !COUNT_PART.test(recurrence)) {
		return undefined;
	}
	return `Cannot use the recurrence rule "${recurrence}": a number of repetitions (COUNT) never ends here, because each completion counts again. Use an end date instead (UNTIL=20261231, or "until December 31, 2026"). Nothing was written.`;
}

function withCountCheck(tool: ToolSpec): ToolSpec {
	const ruleOf = RULE_ARGUMENTS[tool.name];
	if (!ruleOf) return tool;
	return {
		...tool,
		async execute(args) {
			const error = countRejection(ruleOf(args));
			if (error === undefined) return tool.execute(args);
			const updated = tool.name === "batch_update_tasks" ? { updated: 0 } : {};
			return {
				name: tool.name,
				result: { success: false, error, ...updated },
			};
		},
	};
}

/**
 * complete_task that, for a task whose rule v0.8.0 split over two lines and
 * that was read without the second, reports how to fix the note instead of
 * the library's "Cannot read the recurrence rule" for the "DTSTART" part.
 */
function withSplitRuleFix(
	tool: ToolSpec,
	ctx: ObsidianCapabilityContext,
): ToolSpec {
	if (tool.name !== "complete_task") return tool;
	return {
		...tool,
		async execute(args) {
			const fix =
				typeof args.id === "string"
					? await ctx.splitRuleFix(args.id)
					: undefined;
			if (fix === undefined) return tool.execute(args);
			return {
				name: tool.name,
				result: {
					success: false,
					error: `${fix} Task ${String(args.id)} was not completed.`,
				},
			};
		},
	};
}

/**
 * The library's capabilities over `ctx`, as the MCP server serves them:
 * create_task, update_task and batch_update_tasks also reject RRULE counts
 * before anything is written (see {@link countRejection}), and complete_task
 * gives the manual fix for a split rule read without its second line (see
 * {@link withSplitRuleFix}).
 */
export function createObsidianCapabilities(
	ctx: ObsidianCapabilityContext,
): Capabilities {
	const capabilities = createCapabilities(ctx);
	const tools = capabilities.tools
		.map(withCountCheck)
		.map((tool) => withSplitRuleFix(tool, ctx));
	const byName = new Map(tools.map((tool) => [tool.name, tool]));
	return {
		...capabilities,
		tools,
		getTool: (name) => byName.get(name),
		executeTool: async (name, args) => {
			const tool = byName.get(name);
			if (!tool) return capabilities.executeTool(name, args);
			try {
				return await tool.execute(args);
			} catch (error) {
				return {
					name,
					result: {
						error: error instanceof Error ? error.message : String(error),
					},
				};
			}
		},
	};
}
