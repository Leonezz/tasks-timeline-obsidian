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
import { ObsidianTasksRepo, taskUpdateNeedsWrite } from "./tasksRepo";
import { isSameTaskLine, StaleTaskError } from "./taskLine";
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

/** The stale-id error tells AI clients to query again; users get this. */
const STALE_TASK_IN_VIEW =
	"this note changed in the editor; the timeline is refreshing — reopen the task and try again.";

const describeFailure = (action: string, error: unknown): string => {
	if (error instanceof StaleTaskError) {
		return `Failed to ${action}: ${STALE_TASK_IN_VIEW}`;
	}
	return error instanceof Error
		? `Failed to ${action}: ${error.message}`
		: `Failed to ${action}.`;
};

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

	// Keep the repository's cache in step with the vault: a modified note is
	// read only once Obsidian has re-indexed it, so it is never parsed with
	// list item positions from before the change. Registered before the
	// initial load.
	useEffect(() => stableTasksRepo.current.watchVault(), []);

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

	// Reload on vault changes via metadataCache resolved event.
	// This fires after Obsidian has re-indexed a file's metadata,
	// ensuring listItems are up-to-date when we reload tasks.
	// Deletes and renames don't re-index, so they reload too. The
	// repository's watcher invalidates the files involved.
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
				reload();
			}
		});
		const renameRef = plugin.app.vault.on("rename", (file) => {
			if (file.name.endsWith(".md")) {
				console.debug("[TasksTimeline] vault rename:", file.path);
				reload();
			}
		});

		return () => {
			plugin.app.metadataCache.offref(resolvedRef);
			plugin.app.vault.offref(deleteRef);
			plugin.app.vault.offref(renameRef);
			reload.cancel();
		};
	}, [plugin]);

	// The task's note changed after the timeline loaded it: reload so the
	// user can retry on current data. The reload waits for Obsidian to
	// re-index a note modified meanwhile (see watchVault), so the stale write
	// does not leave the timeline showing the note parsed with old positions.
	// It reloads now rather than on "resolved": a copy from before a reload
	// is stale without the note changing, and then nothing gets re-indexed.
	const refreshAfterStale = (error: unknown, task: Task) => {
		if (!(error instanceof StaleTaskError)) return;
		if (task.extra?.file) {
			stableTasksRepo.current.invalidateFile(task.extra.file);
		}
		void loadTasks();
	};

	// Task CRUD handlers. Each rethrows after notifying so its caller (the
	// timeline UI or an AI tool) reports the failure instead of success.
	const handleTaskAdded = async (task: Task): Promise<Task> => {
		try {
			const stored = await stableTasksRepo.current.addTask(task);
			// Make the stored task (with its file-position id) visible to the
			// agent right away so a follow-up update in the same turn finds it.
			// The metadataCache "resolved" reload still refreshes the full list.
			setTasks((prev) =>
				prev.some((t) => t.id === stored.id) ? prev : [...prev, stored],
			);
			return stored;
		} catch (error) {
			console.error("Failed to add task:", error);
			new Notice(describeFailure("add task", error));
			throw error;
		}
	};

	const handleTaskUpdated = async (task: Task, previous: Task) => {
		try {
			// An editor opened before a reload saves a copy of what the id
			// named then; `previous` is what it names now. Refuse before
			// anything mixes the two tasks.
			const copyLine = task.extra?.rawText;
			const currentLine = previous.extra?.rawText;
			if (copyLine && currentLine && !isSameTaskLine(copyLine, currentLine)) {
				throw new StaleTaskError(task.id);
			}
			if (!taskUpdateNeedsWrite(task, previous)) {
				return;
			}
			const storedText = await stableTasksRepo.current.writeTaskLine(task);
			// Update local state only after successful save, with the line as
			// now written: an editor opened from this copy before the reload
			// must still match the reloaded task.
			const stored = {
				...task,
				extra: { ...task.extra, rawText: storedText },
			};
			setTasks((prev) =>
				prev.map((t) => (t.id === stored.id ? stored : t)),
			);
		} catch (error) {
			console.error("Failed to update task:", error);
			new Notice(describeFailure("update task", error));
			refreshAfterStale(error, previous);
			throw error;
		}
	};

	const handleTaskDeleted = async (taskId: string, previous: Task) => {
		try {
			await stableTasksRepo.current.deleteTask(taskId);
			// Update local state only after successful delete
			setTasks((prev) => prev.filter((t) => t.id !== taskId));
		} catch (error) {
			console.error("Failed to delete task:", error);
			new Notice(describeFailure("delete task", error));
			refreshAfterStale(error, previous);
			throw error;
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
			// The editor and the agent write rules as Obsidian Tasks text, also
			// for tasks without Tasks fields (e.g. daily-note tasks).
			recurrenceFormat="text"
			aiSystemPrompt={OBSIDIAN_AI_SYSTEM_PROMPT}
			voiceRuntime={voiceRuntime}
		/>
	);
};
