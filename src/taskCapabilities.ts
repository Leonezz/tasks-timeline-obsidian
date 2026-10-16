import { Notice } from "obsidian";
import type {
	CapabilityContext,
	Task,
} from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "./main";
import { SecurityManager } from "./mcpSecurity";
import { ObsidianTasksRepo } from "./tasksRepo";

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

	return {
		async getTasks(): Promise<Task[]> {
			const tasks = await tasksRepo.loadTasks();
			return securityManager ? securityManager.filterTasks(tasks) : tasks;
		},

		async getTask(id: string): Promise<Task | null> {
			const task = await tasksRepo.getTask(id);
			if (task && securityManager && !securityManager.isTaskAllowed(task)) {
				return null;
			}
			return task;
		},

		async addTask(task: Task): Promise<Task> {
			const targetPath = getTaskTargetPath(plugin, task);
			assertAllowedPath(securityManager, targetPath, "add task");
			assertAllowedTask(securityManager, task, "add task");

			// Return the stored task: its id comes from the file position, so
			// create_task must report it instead of its own temporary id.
			return tasksRepo.addTask(task);
		},

		async updateTask(task: Task): Promise<void> {
			const existingTask = await tasksRepo.getTask(task.id);
			if (!existingTask) {
				throw new Error(`Cannot update task: task not found: ${task.id}`);
			}

			const targetPath = getTaskTargetPath(plugin, task, existingTask);
			assertAllowedTask(securityManager, existingTask, "update task");
			assertAllowedPath(securityManager, targetPath, "update task");
			assertAllowedTask(securityManager, task, "update task");

			await tasksRepo.updateTask(task);
		},

		async deleteTask(id: string): Promise<void> {
			const existingTask = await tasksRepo.getTask(id);
			if (!existingTask) {
				throw new Error(`Cannot delete task: task not found: ${id}`);
			}

			const targetPath = getTaskTargetPath(plugin, existingTask);
			assertAllowedTask(securityManager, existingTask, "delete task");
			assertAllowedPath(securityManager, targetPath, "delete task");

			await tasksRepo.deleteTask(id);
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
