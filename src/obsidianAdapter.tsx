import {
	Task,
	TasksTimelineApp,
	type VoiceRuntime,
} from "@tasks-timeline/components";
import { Events } from "eventbus";
import TasksTimelineObsidianPlugin from "main";
import {
	startTransition,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ObsidianSettingRepo } from "./settingsRepo";
import { ObsidianTasksRepo } from "./tasksRepo";
import { ObsidianSecretField } from "./secretField";
import { createRenderTitle } from "./titleRenderer";
import { App, debounce, Notice, Pos, requestUrl, TFile } from "obsidian";
import { getActiveWindow } from "./obsidianDom";

interface ObsidianAdaptorProps {
	plugin: TasksTimelineObsidianPlugin;
}

const OBSIDIAN_AI_SYSTEM_PROMPT = `You are operating inside an Obsidian vault where the user's requests are often information for finding and manipulating todo items, not just plain conversation.

- Treat todo items as vault-backed markdown tasks. Each task belongs to the note file shown by its category/file path, so the note path is part of the task's meaning.
- The user's wording may refer to a task indirectly through a note, project, meeting, daily note, tag, linked concept, or surrounding context in the vault. Use the available task query tools to find the relevant task candidates before updating, completing, cancelling, or deleting anything.
- When creating a task, choose the target category/file path that best matches the note or project the user is talking about. If the destination note is unclear, ask a short clarification instead of guessing.
- When changing existing tasks, preserve vault-specific metadata and unrelated task fields. Use task IDs returned by query results rather than inventing IDs or relying only on title text.
- If multiple tasks could match the user's intent, ask the user to choose or narrow the scope before destructive or bulk changes.`;

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
	const voiceRuntime = useMemo<VoiceRuntime>(
		() => ({
			win: getActiveWindow(plugin.app),
			request: async (request) => {
				const response = await requestUrl({
					url: request.url,
					method: request.method,
					headers: request.headers,
					contentType: request.contentType,
					body: request.body,
					throw: false,
				});
				return {
					status: response.status,
					text: response.text,
				};
			},
		}),
		[plugin.app],
	);

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

	// Listen to vault changes via metadataCache resolved event.
	// This fires after Obsidian has re-indexed a file's metadata,
	// ensuring listItems are up-to-date when we reload tasks.
	useEffect(() => {
		const reload = debounce(
			() => {
				console.debug(
					"[TasksTimeline] reload triggered, loading tasks…",
				);
				void loadTasks();
			},
			500,
			false,
		);

		const resolvedRef = plugin.app.metadataCache.on("resolved", () => {
			console.debug("[TasksTimeline] metadataCache resolved");
			reload();
		});

		const deleteRef = plugin.app.vault.on("delete", (file) => {
			if (file.name.endsWith(".md")) {
				console.debug("[TasksTimeline] vault delete:", file.path);
				stableTasksRepo.current.invalidateFile(file.path);
				reload();
			}
		});
		const renameRef = plugin.app.vault.on("rename", (file) => {
			if (file.name.endsWith(".md")) {
				console.debug("[TasksTimeline] vault rename:", file.path);
				stableTasksRepo.current.invalidateFile(file.path);
				reload();
			}
		});

		// Also invalidate file cache when vault modifies a file
		const modifyRef = plugin.app.vault.on("modify", (file) => {
			if (file.name.endsWith(".md")) {
				console.debug(
					"[TasksTimeline] vault modify (invalidate cache):",
					file.path,
				);
				stableTasksRepo.current.invalidateFile(file.path);
			}
		});

		return () => {
			plugin.app.metadataCache.offref(resolvedRef);
			plugin.app.vault.offref(deleteRef);
			plugin.app.vault.offref(renameRef);
			plugin.app.vault.offref(modifyRef);
			reload.cancel();
		};
	}, [plugin]);

	// Task CRUD handlers
	const handleTaskAdded = async (task: Task) => {
		try {
			await stableTasksRepo.current.addTask(task);
			// Don't call loadTasks() here — vault.process() triggers a "modify"
			// event that invalidates the file cache, followed by a metadataCache
			// "resolved" event that reloads tasks with fresh metadata.
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
			renderSecretField={(context) => (
				<ObsidianSecretField context={context} plugin={plugin} />
			)}
			aiSystemPrompt={OBSIDIAN_AI_SYSTEM_PROMPT}
			voiceRuntime={voiceRuntime}
		/>
	);
};
