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

/**
 * Creates the shared task capability context used by MCP and future AI hosts.
 *
 * The Obsidian repository stays responsible for persistence. This adapter owns
 * policy checks and host UI feedback so every AI surface uses the same task
 * semantics.
 */
export function createObsidianCapabilityContext(
	plugin: TasksTimelineObsidianPlugin,
	securityManager?: SecurityManager,
): CapabilityContext {
	const tasksRepo = new ObsidianTasksRepo(plugin);

	return {
		async getTasks(): Promise<Task[]> {
			const tasks = await tasksRepo.loadTasks();
			return securityManager ? securityManager.filterTasks(tasks) : tasks;
		},

		async getTask(id: string): Promise<Task | null> {
			const tasks = await tasksRepo.loadTasks();
			const task = tasks.find((t) => t.id === id) ?? null;
			if (task && securityManager && !securityManager.isTaskAllowed(task)) {
				return null;
			}
			return task;
		},

		async addTask(task: Task): Promise<void> {
			const targetPath = getTaskTargetPath(plugin, task);
			assertAllowedPath(securityManager, targetPath, "add task");
			assertAllowedTask(securityManager, task, "add task");

			await tasksRepo.addTask(task);
		},

		async updateTask(task: Task): Promise<void> {
			const tasks = await tasksRepo.loadTasks();
			const existingTask = tasks.find((t) => t.id === task.id);
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
			const tasks = await tasksRepo.loadTasks();
			const existingTask = tasks.find((t) => t.id === id);
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
	};
}
