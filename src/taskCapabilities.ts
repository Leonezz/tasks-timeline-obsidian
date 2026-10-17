import { Notice } from "obsidian";
import type {
	CapabilityContext,
	Task,
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

	return {
		async getTasks(): Promise<Task[]> {
			const tasks = await tasksRepo.loadTasks();
			const allowed = securityManager
				? securityManager.filterTasks(tasks)
				: tasks;
			return allowed.map(issue);
		},

		async getTask(id: string): Promise<Task | null> {
			const task = await readIssued(id);
			if (securityManager && !securityManager.isTaskAllowed(task)) {
				return null;
			}
			return issue(task);
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

		dispose: stopWatching,
	};
}
