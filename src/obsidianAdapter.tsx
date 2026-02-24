import { Task, TasksTimelineApp } from "@tasks-timeline/components";
import { Events } from "eventbus";
import TasksTimelineObsidianPlugin from "main";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { ObsidianSettingRepo } from "./settingsRepo";
import { ObsidianTasksRepo } from "./tasksRepo";
import { createRenderTitle } from "./titleRenderer";
import { App, debounce, Notice, Pos, TFile } from "obsidian";

interface ObsidianAdaptorProps {
	plugin: TasksTimelineObsidianPlugin;
}

const handleItemClick = (item: Task, app: App) => {
	if (!item.extra?.file) {
		new Notice("Task file not found");
		return;
	}

	const file = app.vault.getAbstractFileByPath(item.extra.file);
	if (!(file instanceof TFile)) {
		new Notice("Task file not found");
		return;
	}

	try {
		const position = item.extra.position
			? (JSON.parse(item.extra.position) as Pos)
			: undefined;

		void app.workspace.openLinkText("", item.extra.file).then(() => {
			if (position === undefined) {
				return;
			}
			const file = app.workspace.getActiveFile();
			if (file) {
				void app.workspace.getLeaf().openFile(file, {
					state: { mode: "source" },
				});
			}
			app.workspace.activeEditor?.editor?.setSelection(
				{
					line: position.start.line,
					ch: position.start.col,
				},
				{
					line: position.start.line,
					ch: position.end.col,
				},
			);
			if (!app.workspace.activeEditor?.editor?.hasFocus()) {
				app.workspace.activeEditor?.editor?.focus();
			}
		});
	} catch (error) {
		console.error("Failed to open task file:", error);
		new Notice("Failed to open task file");
	}
};

export const ObsidianAdaptor = ({ plugin }: ObsidianAdaptorProps) => {
	const [isDarkMode, setIsDarkMode] = useState(
		plugin.settings.systemInDarkMode,
	);

	// Tasks state - loaded from repository
	const [tasks, setTasks] = useState<Task[]>([]);

	// Stable repository instance that holds the cache
	const stableTasksRepo = useRef(new ObsidianTasksRepo(plugin));
	const [settingsRepo, setSettingsRepo] = useState(
		() => new ObsidianSettingRepo(plugin),
	);
	const renderTitle = useMemo(() => createRenderTitle(plugin.app), [plugin]);

	// Load tasks on mount and when refreshToken changes
	const loadTasks = async () => {
		const loadedTasks = await stableTasksRepo.current.loadTasks();
		startTransition(() => {
			setTasks(loadedTasks);
		});
	};

	// Initial load
	useEffect(() => {
		void loadTasks();
	}, []);

	// Listen to theme changes
	useEffect(() => {
		return plugin.bus.on(
			"system:themeChange",
			({ isDarkMode }: Events["system:themeChange"]) => {
				setIsDarkMode(isDarkMode);
			},
		);
	}, []);

	// Reload settings when changed from the settings page
	useEffect(() => {
		return plugin.bus.on("settings:changed", () => {
			void settingsRepo.loadSettings().then((s) => {
				if (s) {
					// Force TasksTimelineApp to re-render with fresh settings
					// by replacing the repo instance, which resets internal state.
					setSettingsRepo(new ObsidianSettingRepo(plugin));
				}
			});
		});
	}, [plugin, settingsRepo]);

	// Listen to vault changes
	useEffect(() => {
		// Debounced reload function (trailing edge to batch rapid changes)
		const reload = debounce(
			() => {
				void loadTasks();
			},
			1000,
			false,
		);

		const eventRef = plugin.app.vault.on("modify", (file) => {
			// Optimization: only reload if it's a markdown file
			if (file.name.endsWith(".md")) {
				stableTasksRepo.current.invalidateFile(file.path);
				reload();
			}
		});

		// Also listen for delete/rename
		const deleteRef = plugin.app.vault.on("delete", reload);
		const renameRef = plugin.app.vault.on("rename", reload);

		return () => {
			plugin.app.vault.offref(eventRef);
			plugin.app.vault.offref(deleteRef);
			plugin.app.vault.offref(renameRef);
			reload.cancel();
		};
	}, [plugin]);

	// Task CRUD handlers
	const handleTaskAdded = async (task: Task) => {
		try {
			await stableTasksRepo.current.addTask(task);
			await loadTasks();
		} catch (error) {
			console.error("Failed to add task:", error);
			new Notice("Failed to add task.");
		}
	};

	const handleTaskUpdated = async (task: Task, previous: Task) => {
		// Skip update if nothing actually changed
		if (
			task.title === previous.title &&
			task.status === previous.status &&
			task.priority === previous.priority &&
			task.dueAt === previous.dueAt &&
			task.completedAt === previous.completedAt &&
			task.startAt === previous.startAt &&
			task.createdAt === previous.createdAt
		) {
			return;
		}

		try {
			await stableTasksRepo.current.updateTask(task);
			// Update local state only after successful save
			setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
		} catch (error) {
			console.error("Failed to update task:", error);
			new Notice("Failed to update task. Changes not saved.");
		}
	};

	const handleTaskDeleted = async (taskId: string, previous: Task) => {
		try {
			await stableTasksRepo.current.deleteTask(taskId);
			// Update local state only after successful delete
			setTasks((prev) => prev.filter((t) => t.id !== taskId));
		} catch (error) {
			console.error("Failed to delete task:", error);
			new Notice("Failed to delete task.");
		}
	};

	return (
		<TasksTimelineApp
			tasks={tasks}
			onTaskAdded={handleTaskAdded}
			onTaskUpdated={handleTaskUpdated}
			onTaskDeleted={handleTaskDeleted}
			settingsRepository={settingsRepo}
			systemInDarkMode={isDarkMode}
			onItemClick={(item) => handleItemClick(item, plugin.app)}
			renderTitle={renderTitle}
			aiSystemPrompt="In this Obsidian vault, each task's category is derived from the path of the note file it belongs to. When reasoning about tasks, treat the category as the file-level topic or project the task is part of."
		/>
	);
};
