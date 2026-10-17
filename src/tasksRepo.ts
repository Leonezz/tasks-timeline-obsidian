import {
	FrontMatterCache,
	LinkCache,
	ListItemCache,
	Notice,
	Pos,
	SectionCache,
	TAbstractFile,
	TagCache,
	TFile,
} from "obsidian";
import {
	dailyNoteTaskParser,
	markerBasedStatusParser,
	parseDataViewFormatItem,
	remainderParser,
	tagsParser,
} from "./parsers";
import TasksTimelineObsidianPlugin from "./main";
import { Link } from "./link";
import { withNotesForNewLine, writeTaskOnLine } from "./lineWriter";
import {
	asReadFromRepairedLine,
	readWithRuleLine,
	repairSplitRule,
	splitRuleFix,
	withJoinedSplitRule,
} from "./splitRule";
import {
	filePathOfTaskId,
	hasNestedItems,
	isSameTaskLine,
	locateTaskBlock,
	locateTaskLine,
	snapshotOf,
	StaleTaskError,
	storedLineText,
	TaskSnapshot,
} from "./taskLine";
import {
	getTaskStatusFromMarker,
	parseTasksFormatItem,
	Task,
	TaskRegularExpressions,
	TaskRepository,
	taskToMarkdown,
} from "@tasks-timeline/components";

/** How long addTask waits for Obsidian to index the line it appended. */
const ADDED_TASK_INDEX_TIMEOUT_MS = 5000;

/** How long a read waits for Obsidian to re-index a note that was modified. */
const REINDEX_TIMEOUT_MS = 3000;

/**
 * Task fields that `updateTask` cannot persist: it only rewrites the task's
 * own line, which holds neither a description nor the note it lives in.
 */
const LINE_UNSTORABLE_FIELDS = ["description", "category"] as const;

const tagKey = (name: string) => name.replace(/^#/, "");

function frontmatterTagsOf(task: Task): string[] {
	try {
		const parsed: unknown = JSON.parse(task.extra?.frontmatterTags ?? "[]");
		return Array.isArray(parsed)
			? parsed.filter((tag): tag is string => typeof tag === "string")
			: [];
	} catch (error) {
		console.warn("Failed to parse frontmatter tags", error);
		return [];
	}
}

/**
 * Changes the vault line cannot store: description and category, and
 * removing a tag the task gets from its note's frontmatter (the line would
 * stay the same and the tag would come back on the next read).
 */
function unstorableChanges(task: Task, previous: Task): string[] {
	const fields = LINE_UNSTORABLE_FIELDS.filter(
		(field) => (task[field] ?? "").trim() !== (previous[field] ?? "").trim(),
	);
	const kept = new Set(task.tags.map((tag) => tagKey(tag.name)));
	const removedFrontmatterTags = frontmatterTagsOf(previous)
		.filter((tag) => !kept.has(tagKey(tag)))
		.map((tag) => `frontmatter tag ${tag}`);
	return [...fields, ...removedFrontmatterTags];
}

/**
 * Line breaks a title can't hold: \r and \n, and the line and paragraph
 * separators (U+2028, U+2029), where the line writer's patterns (".")
 * also end a line. NEL (U+0085) is not here: neither those patterns nor
 * Obsidian end a line at it.
 */
const LINE_BREAK = /[\r\n\u2028\u2029]/;

/**
 * Throws for a title with a line break: a task line holds one line, and the
 * text after the break would become lines of its own (extra tasks, if it
 * reads "- [ ] …"), or, after U+2028 or U+2029, be written twice on the
 * line. Details go in the description.
 */
function assertSingleLineTitle(task: Task, action: string): void {
	if (LINE_BREAK.test(task.title)) {
		throw new Error(
			`Cannot ${action}: the title has a line break, and a task line can only hold one line. Put the title on one line and the rest in the description.`,
		);
	}
}

/**
 * Decides whether an edit of a vault task needs a write.
 *
 * Both versions are serialized onto the stored line, so only changes the line
 * can hold count, and a no-op edit (e.g. leaving inline edit mode) neither
 * rewrites nor reformats the line.
 *
 * @returns false when nothing changed; true when the serialized line changes,
 * or when the stored line is unknown (`updateTask` then locates it itself).
 * @throws when the edit changes anything the vault line cannot store, even
 * alongside changes it can: saving only part of an edit would drop the rest
 * without a word; and for a title with a line break.
 */
export function taskUpdateNeedsWrite(task: Task, previous: Task): boolean {
	assertSingleLineTitle(task, "update task");
	const unstorable = unstorableChanges(task, previous);
	if (unstorable.length > 0) {
		const frontmatterHint = unstorable.some((change) =>
			change.startsWith("frontmatter tag"),
		)
			? " Frontmatter tags are changed in the note's frontmatter."
			: "";
		throw new Error(
			`Cannot update task: ${unstorable.join(" and ")} cannot be stored in the vault line. Only the task line (title, status, priority, dates, tags, recurrence) is saved.${frontmatterHint}`,
		);
	}
	const rawText = previous.extra?.rawText;
	if (!rawText) {
		return true;
	}
	// Compared on the line a rule split by v0.8.0 is repaired to, so a no-op
	// edit leaves such a line alone (writeTaskLine repairs it on a change).
	// A task read with the rule's second line was read as that line reads.
	const [line = "", next, ...below] = rawText.split("\n");
	const repair = repairSplitRule(line, next);
	const text = repair ? [repair.line, ...below].join("\n") : rawText;
	return writeTaskOnLine(task, text) !== writeTaskOnLine(previous, text);
}

/**
 * A new task with the Obsidian Tasks fields typed into its title
 * ("Pay rent 📅 2026-10-20", "Fix bug 🔺") read as fields, as a reload reads
 * them back. Without this, writing the title onto the new line would fail:
 * the typed field would read back as a field the task doesn't have.
 *
 * Fields the task sets win over typed ones, except the defaults the timeline
 * fills in for every new task: a typed priority wins over "medium", and a
 * typed ➕ date over the created date.
 */
function withTypedFields(task: Task): Task {
	const typed = parseTasksFormatItem(task);
	const hasRule = task.recurringInterval !== undefined;
	return {
		...task,
		title: typed.title,
		priority: task.priority === "medium" ? typed.priority : task.priority,
		createdAt: typed.createdAt ?? task.createdAt,
		dueAt: task.dueAt ?? typed.dueAt,
		startAt: task.startAt ?? typed.startAt,
		completedAt: task.completedAt ?? typed.completedAt,
		cancelledAt: task.cancelledAt ?? typed.cancelledAt,
		isRecurring: hasRule ? task.isRecurring : typed.isRecurring,
		recurringInterval: hasRule
			? task.recurringInterval
			: typed.recurringInterval,
		onCompletion: task.onCompletion ?? typed.onCompletion,
		taskId: task.taskId ?? typed.taskId,
		dependsOn: task.dependsOn ?? typed.dependsOn,
		extra: { ...typed.extra, ...task.extra },
	};
}

export class ObsidianTasksRepo implements TaskRepository {
	name: string = "Obsidian Notes";
	plugin: TasksTimelineObsidianPlugin;
	/** Task lines as last handed out, by id. Writes check them for staleness. */
	private taskCache = new Map<string, TaskSnapshot>();
	private fileTaskCache = new Map<string, Task[]>();
	/** Bumped on invalidation so a read that started earlier is not cached. */
	private fileGenerations = new Map<string, number>();
	/** Notes modified but not yet re-indexed; reads wait for the re-index. */
	private pendingReindex = new Map<
		string,
		{ done: Promise<void>; finish: () => void }
	>();

	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;
	}

	invalidateFile(path: string) {
		this.fileTaskCache.delete(path);
		const generation = this.fileGenerations.get(path) ?? 0;
		this.fileGenerations.set(path, generation + 1);
	}

	/**
	 * Keeps cached tasks in step with the vault (used by the timeline view and
	 * the MCP server). A modified note is read only after Obsidian re-indexes
	 * it ("changed"): before that its new content does not match the list
	 * item positions in the metadata cache.
	 *
	 * @returns a function that removes the listeners
	 */
	watchVault(): () => void {
		const { vault, metadataCache } = this.plugin.app;
		const isNote = (file: TAbstractFile): file is TFile =>
			file instanceof TFile && file.extension === "md";

		const vaultRefs = [
			vault.on("modify", (file) => {
				if (!isNote(file)) return;
				this.invalidateFile(file.path);
				this.expectReindex(file.path);
			}),
			vault.on("delete", (file) => this.invalidateFile(file.path)),
			vault.on("rename", (file, oldPath) => {
				this.invalidateFile(oldPath);
				this.invalidateFile(file.path);
			}),
		];
		const changedRef = metadataCache.on("changed", (file) => {
			this.invalidateFile(file.path);
			this.finishReindex(file.path);
		});

		return () => {
			vaultRefs.forEach((ref) => vault.offref(ref));
			metadataCache.offref(changedRef);
			[...this.pendingReindex.keys()].forEach((path) =>
				this.finishReindex(path),
			);
		};
	}

	private expectReindex(path: string): void {
		if (this.pendingReindex.has(path)) return;
		let resolve: () => void = () => undefined;
		const done = new Promise<void>((r) => {
			resolve = r;
		});
		const timer = window.setTimeout(() => {
			console.warn(
				`Obsidian did not re-index ${path} within ${REINDEX_TIMEOUT_MS / 1000}s; reading it anyway.`,
			);
			this.finishReindex(path);
		}, REINDEX_TIMEOUT_MS);
		this.pendingReindex.set(path, {
			done,
			finish: () => {
				window.clearTimeout(timer);
				resolve();
			},
		});
	}

	private finishReindex(path: string): void {
		const pending = this.pendingReindex.get(path);
		this.pendingReindex.delete(path);
		pending?.finish();
	}

	async loadTasks(): Promise<Task[]> {
		const files = this.plugin.app.vault.getMarkdownFiles();
		const failedFiles: string[] = [];
		const results = await Promise.all(
			files.map(async (file) => {
				try {
					return await this.readFileTasks(file);
				} catch (reason) {
					console.error(`Read file ${file.path} failed:`, reason);
					failedFiles.push(file.path);
					return [] as Task[];
				}
			}),
		);
		const flattenedTasks = results.flat();

		// Notify user if some files couldn't be read
		if (failedFiles.length > 0) {
			new Notice(
				`Warning: ${failedFiles.length} file(s) could not be read. Some tasks may be missing.`,
			);
			console.warn("Failed to read files:", failedFiles);
		}

		// Swap the id snapshot in one step, so lookups during a load still
		// see the previous one instead of an empty cache.
		const snapshots = new Map<string, TaskSnapshot>();
		flattenedTasks.forEach((task) => {
			const snapshot = snapshotOf(task);
			if (snapshot) snapshots.set(task.id, snapshot);
		});
		this.taskCache = snapshots;

		return flattenedTasks;
	}

	/**
	 * Re-reads a task's note and returns the task as it is now.
	 *
	 * Ids are line positions, so after a note changes an id can name a
	 * different task. When `id` was handed out before and its line has changed
	 * since, this throws instead of returning whatever task sits there now.
	 *
	 * @returns null when no task has this id
	 */
	async getTask(id: string): Promise<Task | null> {
		const snapshot = this.taskCache.get(id);
		const path = snapshot?.file ?? filePathOfTaskId(id);
		const file = path
			? this.plugin.app.vault.getAbstractFileByPath(path)
			: null;
		let current: Task | undefined;
		if (file instanceof TFile) {
			this.invalidateFile(file.path);
			const tasks = await this.readFileTasks(file);
			current = tasks.find((t) => t.id === id);
		}

		const currentLine = current?.extra?.rawText;
		const unchanged =
			currentLine !== undefined &&
			snapshot !== undefined &&
			isSameTaskLine(currentLine, snapshot.rawText);
		if (snapshot && !unchanged) {
			throw new StaleTaskError(id);
		}
		if (!current) {
			return null;
		}
		const currentSnapshot = snapshotOf(current);
		if (currentSnapshot) this.taskCache.set(id, currentSnapshot);
		return current;
	}

	/** Parses a note's tasks, from the file cache while it is still valid. */
	private async readFileTasks(file: TFile): Promise<Task[]> {
		await this.pendingReindex.get(file.path)?.done;
		const cachedTasks = this.fileTaskCache.get(file.path);
		if (cachedTasks) {
			return cachedTasks;
		}

		const generation = this.fileGenerations.get(file.path) ?? 0;
		const content = await this.plugin.app.vault.cachedRead(file);
		const cache = this.plugin.app.metadataCache.getFileCache(file);
		const tasks =
			cache?.listItems
				?.map(
					this.fromItemCache(
						Link.file(file.path),
						file.path,
						content,
						cache.sections,
						cache.links,
						cache.frontmatter,
						cache.tags,
					),
				)
				.filter((item): item is Task => !!item) || [];

		const processedTasks = tasks
			.map(parseTasksFormatItem)
			.map(withJoinedSplitRule)
			.map(parseDataViewFormatItem)
			.map(dailyNoteTaskParser())
			.map(remainderParser)
			.map(tagsParser)
			.map(markerBasedStatusParser)
			// Ensure tags is always an array (defensive)
			.map((task) => ({
				...task,
				tags: task.tags || [],
			}))
			.map((task) => {
				const seen = new Set<string>();
				return {
					...task,
					tags: task.tags.filter((tag) => {
						if (seen.has(tag.name)) return false;
						seen.add(tag.name);
						return true;
					}),
				};
			});

		// A read the note changed during is returned but not cached.
		if ((this.fileGenerations.get(file.path) ?? 0) === generation) {
			this.fileTaskCache.set(file.path, processedTasks);
		}
		return processedTasks;
	}

	/**
	 * Appends a task to its target note and returns the task as stored in the
	 * vault. Stored ids are derived from file path + line + column (see
	 * `fromLine`), so the id the caller generated is not the one later updates
	 * must use. The returned task carries the real id.
	 */
	async addTask(task: Task): Promise<Task> {
		const targetFile =
			task.category ||
			this.plugin.settings.appSetting.defaultCategory ||
			"Tasks.md";

		const vault = this.plugin.app.vault;
		const file = vault.getAbstractFileByPath(targetFile);

		if (!(file instanceof TFile)) {
			throw new Error(
				file
					? `Cannot add task: path is not a file: ${targetFile}`
					: `Cannot add task: target note not found: ${targetFile}`,
			);
		}
		if (file.extension !== "md") {
			throw new Error(
				`Cannot add task: target note is not a markdown file: ${targetFile}`,
			);
		}

		assertSingleLineTitle(task, "add task");

		// The typed title is the new line's text, so Tasks fields typed into
		// it ("Pay rent 📅 2026-10-20") stay on the line as typed.
		const statusMarker = task.status === "done" ? "x" : " ";
		const templateLine = `- [${statusMarker}] ${task.title}`;
		const taskLine = taskToMarkdown(
			withTypedFields(withNotesForNewLine(task)),
			templateLine,
		);

		const descriptionLine = task.description?.trim()
			? "\t" + task.description.trim().replace(/\n/g, "\n\t")
			: "";

		let insertedLine = -1;
		await vault.process(file, (content) => {
			const block =
				taskLine + (descriptionLine ? "\n" + descriptionLine : "");
			const prefix =
				content.length > 0 && !content.endsWith("\n")
					? content + "\n"
					: content;
			insertedLine = prefix.split("\n").length - 1;
			return prefix + block + "\n";
		});

		this.invalidateFile(targetFile);
		return this.readAddedTask(file, insertedLine, taskLine);
	}

	/**
	 * Re-reads a freshly appended task once Obsidian has indexed the new line.
	 *
	 * The metadata cache can lag behind: when another write to the note just
	 * before this one moved lines up (a deleted task, a split rule joined
	 * into one line), an older index can already have a list item on the new
	 * line's index, and the first re-index after that write does not have
	 * the appended line yet. So a task is only taken as the added one when
	 * its line is the line that was written, and until then each re-index of
	 * the note is read again, up to a timeout.
	 */
	private async readAddedTask(
		file: TFile,
		line: number,
		writtenLine: string,
	): Promise<Task> {
		const reindexes = this.watchReindexes(file, ADDED_TASK_INDEX_TIMEOUT_MS);
		let indexed = false;
		try {
			for (;;) {
				const seen = reindexes.count();
				if (this.hasTaskItemAt(file, line)) {
					indexed = true;
					const stored = await this.readTaskWrittenAt(
						file,
						line,
						writtenLine,
					);
					if (stored) return stored;
				}
				if (!(await reindexes.after(seen))) break;
			}
		} finally {
			reindexes.dispose();
		}
		throw new Error(
			indexed
				? `Task was written to ${file.path} (line ${line + 1}) but could not be read back as a task. List tasks to find its id before changing it.`
				: `Task was written to ${file.path} (line ${line + 1}) but Obsidian did not index it within ${ADDED_TASK_INDEX_TIMEOUT_MS / 1000}s. List tasks to find its id before changing it.`,
		);
	}

	/** Whether the metadata cache has a task item starting at `line`, column 0. */
	private hasTaskItemAt(file: TFile, line: number): boolean {
		return (
			this.plugin.app.metadataCache
				.getFileCache(file)
				?.listItems?.some(
					(item) =>
						item.task !== undefined &&
						item.position.start.line === line &&
						item.position.start.col === 0,
				) ?? false
		);
	}

	/** The task at `line` if its line is `writtenLine`, remembered for writes. */
	private async readTaskWrittenAt(
		file: TFile,
		line: number,
		writtenLine: string,
	): Promise<Task | undefined> {
		this.invalidateFile(file.path);
		// Read only this note: a full load would also replace the snapshots
		// of tasks the caller has not re-read, hiding their staleness.
		const tasks = await this.readFileTasks(file);
		const stored = tasks.find((t) => {
			const position = t.extra?.position;
			return (
				t.extra?.file === file.path &&
				position !== undefined &&
				(JSON.parse(position) as Pos).start.line === line &&
				t.extra?.rawText?.split("\n")[0] === writtenLine
			);
		});
		if (!stored) return undefined;
		const snapshot = snapshotOf(stored);
		if (snapshot) this.taskCache.set(stored.id, snapshot);
		return stored;
	}

	/**
	 * Counts the re-indexes of `file` from now on, for waiting on the next
	 * one; waits end once `timeoutMs` has passed.
	 */
	private watchReindexes(file: TFile, timeoutMs: number) {
		const metadataCache = this.plugin.app.metadataCache;
		let count = 0;
		let timedOut = false;
		let waiters: (() => void)[] = [];
		const wake = () => {
			const woken = waiters;
			waiters = [];
			woken.forEach((waiter) => waiter());
		};
		const ref = metadataCache.on("changed", (changedFile) => {
			if (changedFile.path !== file.path) return;
			count++;
			wake();
		});
		const timer = window.setTimeout(() => {
			timedOut = true;
			wake();
		}, timeoutMs);
		return {
			count: () => count,
			/** Resolves true on a re-index after the `seen`th, false on timeout. */
			after: (seen: number) =>
				new Promise<boolean>((resolve) => {
					const check = () => {
						if (count > seen) resolve(true);
						else if (timedOut) resolve(false);
						else waiters.push(check);
					};
					check();
				}),
			dispose: () => {
				window.clearTimeout(timer);
				metadataCache.offref(ref);
			},
		};
	}

	saveTasks(tasks: Task[]): Promise<void> {
		return Promise.resolve();
	}

	/** See {@link writeTaskLine}. */
	async updateTask(task: Task): Promise<void> {
		await this.writeTaskLine(task);
	}

	/**
	 * Rewrites a task's line. The line must still hold the text this
	 * repository last handed out for the id (or have moved unchanged);
	 * otherwise the id may now name another task and this throws.
	 *
	 * @returns the task's text as now stored (its line plus description
	 * lines, as a reload reads them), for callers that keep a copy
	 */
	async writeTaskLine(task: Task): Promise<string> {
		assertSingleLineTitle(task, "update task");
		// Prefer the snapshot: the UI component might not preserve extra fields
		const snapshot = this.taskCache.get(task.id);
		const filePath = task.extra?.file || snapshot?.file;

		if (!filePath) {
			throw new Error("Cannot update task: file information missing");
		}
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot update task: file not found: ${filePath}`);
		}
		// The caller's copy must be of the task the id names now. After a
		// reload the id can name another task that moved onto its line, and
		// a copy read before (e.g. in an open editor) must not overwrite it.
		// Copies from before this repository's own writes are still current.
		const callerLine = task.extra?.rawText;
		if (
			snapshot &&
			callerLine &&
			!isSameTaskLine(callerLine, snapshot.rawText) &&
			!isSameTaskLine(callerLine, snapshot.loadedText)
		) {
			throw new StaleTaskError(task.id);
		}
		const expectedLine = snapshot?.rawText || callerLine;
		if (!expectedLine) {
			throw new Error(
				`Cannot update task: ${task.id} was never read from the vault — query tasks again.`,
			);
		}
		const position = snapshot?.position || task.extra?.position;

		const outcome: { writtenLine?: string; joinedLine?: string } = {};
		await this.plugin.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const lineIndex = locateTaskLine(lines, expectedLine, position);
			const originalLine = lines[lineIndex];
			if (originalLine === undefined) {
				return content;
			}
			// A rule v0.8.0 split over this line and the next is joined
			// back into this one. A task read without the rule's second
			// line is first made the task the joined line holds.
			const nextLine = lines[lineIndex + 1];
			const repair = repairSplitRule(originalLine, nextLine);
			const lineTask =
				repair && !readWithRuleLine(expectedLine)
					? asReadFromRepairedLine(task, originalLine, repair)
					: task;
			const newLine = writeTaskOnLine(
				lineTask,
				repair?.line ?? originalLine,
			);
			outcome.writtenLine = newLine;
			outcome.joinedLine = repair ? nextLine : undefined;
			return [
				...lines.slice(0, lineIndex),
				newLine,
				...lines.slice(lineIndex + (repair ? 2 : 1)),
			].join("\n");
		});

		if (outcome.writtenLine === undefined) {
			throw new StaleTaskError(task.id);
		}
		// Remember the written line so a follow-up update of the same task
		// (e.g. leaving inline edit mode) still matches before the next load.
		// Its description lines below were left as they were, except the
		// line of a rule joined into it.
		const [, ...below] = expectedLine.split("\n");
		const joined =
			outcome.joinedLine !== undefined &&
			below[0] !== undefined &&
			isSameTaskLine(below[0], outcome.joinedLine);
		const storedText = [
			storedLineText(outcome.writtenLine, position),
			...(joined ? below.slice(1) : below),
		].join("\n");
		this.taskCache.set(task.id, {
			file: filePath,
			rawText: storedText,
			loadedText: snapshot?.loadedText ?? expectedLine,
			position: position ?? "",
		});
		this.invalidateFile(filePath);
		return storedText;
	}

	/**
	 * The manual fix for a task whose recurrence rule v0.8.0 split over its
	 * line and the next, for a task whose rule reads as "DTSTART…" (it was
	 * read without the second line, or the rule can't be joined). See
	 * {@link splitRuleFix}.
	 *
	 * @returns undefined when its line holds no split rule
	 */
	async splitRuleFix(id: string): Promise<string | undefined> {
		const snapshot = this.taskCache.get(id);
		if (!snapshot) {
			throw new Error(
				`Cannot read task ${id}: it was never read from the vault — query tasks again.`,
			);
		}
		const file = this.plugin.app.vault.getAbstractFileByPath(snapshot.file);
		if (!(file instanceof TFile)) {
			throw new Error(`Cannot read task ${id}: file not found: ${snapshot.file}`);
		}
		const lines = (await this.plugin.app.vault.cachedRead(file)).split("\n");
		const index = locateTaskLine(lines, snapshot.rawText, snapshot.position);
		const line = lines[index];
		if (line === undefined) {
			throw new StaleTaskError(id);
		}
		return splitRuleFix(line, lines[index + 1]);
	}

	async deleteTask(id: string): Promise<void> {
		const cached = this.taskCache.get(id);
		if (!cached) {
			throw new Error(`Cannot delete task: ID not found in cache: ${id}`);
		}

		const file = this.plugin.app.vault.getAbstractFileByPath(cached.file);
		if (!(file instanceof TFile)) {
			throw new Error(
				`Cannot delete task: file not found: ${cached.file}`,
			);
		}

		const outcome: { expectedContent?: string; hasNestedItems?: boolean } =
			{};
		await this.plugin.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			// Remove the description lines too, or they would join the
			// previous task's list item.
			const block = locateTaskBlock(
				lines,
				cached.rawText,
				cached.position,
			);
			if (!block) {
				return content;
			}
			// Refuse rather than delete or re-indent the sub-tasks: either
			// would change tasks the caller did not ask to change.
			if (hasNestedItems(lines, block.start, block.start + block.count)) {
				outcome.hasNestedItems = true;
				return content;
			}
			outcome.expectedContent = [
				...lines.slice(0, block.start),
				...lines.slice(block.start + block.count),
			].join("\n");
			return outcome.expectedContent;
		});

		if (outcome.hasNestedItems) {
			throw new Error(
				"Cannot delete task: it has sub-tasks or other nested items — delete or move them first.",
			);
		}
		if (outcome.expectedContent === undefined) {
			throw new StaleTaskError(id);
		}

		const persistedContent = await this.plugin.app.vault.read(file);
		if (persistedContent !== outcome.expectedContent) {
			throw new Error(
				`Cannot delete task: file write was rejected or changed by Obsidian: ${cached.file}`,
			);
		}

		// Remove from cache only after Obsidian has persisted the delete.
		this.taskCache.delete(id);
		this.invalidateFile(cached.file);
	}

	/**
	 * This function takes all known list items as input and passes them to fromLine.
	 * @param link A Link object points to the file where the list item belongs. It can also be constructed from the file path,
	 * the only reason this is an augment is to avoid constructing one same Link for every item.
	 * @param filePath The path of the file where the list item belongs.
	 * @param fileContent The file content for extracting the raw texts for list items. The reason this is an augment is to avoiding
	 * reading one same file for every item.
	 * @param sections The section cache from Obsidian.
	 * @param links The link cache from Obsidian.
	 * @param fontmatter The fontmatter cache from Obsidian.
	 * @param tags The tag cache from Obsidian.
	 * @returns This funcion directly modify this.taskList.
	 */
	private fromItemCache(
		link: Link,
		filePath: string,
		fileContent: string,
		sections?: SectionCache[],
		links?: LinkCache[],
		fontmatter?: FrontMatterCache,
		tagsCache?: TagCache[],
	) {
		return (item: ListItemCache) => {
			if (!item.task) return null;
			const itemPos = item.position;

			const findParent = () => {
				if (!sections) return null;
				if (item.parent > 0) {
					for (const s of sections) {
						if (s.position.start.line === item.parent) return s;
					}
				} else {
					let p = -1;
					let parentHeader = null;
					for (const s of sections) {
						if (
							s.type === "heading" &&
							s.position.start.line > p &&
							s.position.start.line < item.position.start.line
						) {
							parentHeader = s;
							p = parentHeader.position.start.line;
						}
					}
					return parentHeader;
				}
				return null;
			};

			const findOutLinks = (line: number) => {
				if (!links) return null;
				return links.filter((s) => s.position.start.line === line);
			};

			const findTags = (line: number): string[] | null => {
				if (!tagsCache) return null;
				return tagsCache
					.filter((t) => t.position.start.line === line)
					.map((s) => s.tag);
			};

			const sliceFileContent = (pos: Pos) => {
				return fileContent.slice(pos.start.offset, pos.end.offset);
			};

			const itemText = sliceFileContent(itemPos);
			const parentItem = findParent();
			const outLinks = findOutLinks(itemPos.start.line);
			const parentLink = parentItem
				? link.withSectionCache(
						parentItem,
						sliceFileContent(parentItem?.position),
					)
				: link;
			const outLinkLinks = outLinks
				? outLinks.map((v) => Link.withLinkCache(v))
				: [];

			const tags = findTags(itemPos.start.line);

			return this.fromLine(
				itemText,
				filePath,
				parentLink,
				itemPos,
				outLinkLinks,
				fontmatter,
				tags || [],
			);
		};
	}

	/**
	 * This function parse the raw text of a list item and judge if it is a task item.
	 * If it is a task item, it extract only basic information to construct a TaskDataModel.
	 * All other information should be in the TaskDataModel.text field.
	 * @param line The raw text of the list item, including the list markers
	 * @param filePath The file path where the list item is from.
	 * @param parent A Link object points to the parent section of the list item.
	 * @param position A Pos object from Obsidian.
	 * @param outLinks Links from Obsidian.
	 * //@param children
	 * //@param annotated
	 * @param frontMatter The yaml data in the header of the file where the list item belongs.
	 * @param tags Tag list contained in the list item.
	 * @returns A TaskDataModel with basic information if the list item is a Task, null if it is not.
	 */
	private fromLine(
		line: string,
		filePath: string,
		parent: Link,
		position: Pos,
		outLinks: Link[],
		//children: TaskDataModel[],
		//annotated: boolean,
		frontMatter: FrontMatterCache | undefined,
		tags: string[],
	): Task | null {
		// Check the line to see if it is a markdown task.
		const regexMatch = line.match(TaskRegularExpressions.taskRegex);
		if (regexMatch === null || regexMatch.length < 5) {
			return null;
		}

		// match[4] includes the whole body of the task after the brackets.
		const body = regexMatch[4]!.trim();
		if (!body) {
			return null;
		}
		let description = body;
		//const indentation = regexMatch[1]; // before - [ ]
		// const listMarker = regexMatch[2]!; // - for - [ ]

		// Get the status of the task.
		const statusString = regexMatch[3]!; // x for - [x]
		//const status = statusString;// StatusRegistry.getInstance().bySymbolOrCreate(statusString);

		// Match for block link and remove if found. Always expected to be
		// at the end of the line.
		const blockLinkMatch = description.match(
			TaskRegularExpressions.blockLinkRegex,
		);
		const blockLink = blockLinkMatch !== null ? blockLinkMatch[0] : "";

		if (blockLink !== "") {
			description = description
				.replace(TaskRegularExpressions.blockLinkRegex, "")
				.trim();
		}

		const frontmatterTags: string[] = [];
		if (frontMatter) {
			if (frontMatter["tag"] && typeof frontMatter["tag"] === "string") {
				const frontmatterTagPrefix = frontMatter["tag"].startsWith("#")
					? ""
					: "#";
				const tag = frontmatterTagPrefix + frontMatter["tag"];
				tags.push(tag);
				frontmatterTags.push(tag);
			}
			if (frontMatter["tags"] && Array.isArray(frontMatter["tags"])) {
				(frontMatter["tags"] as string[]).forEach((t) => {
					const tag = t.startsWith("#") ? t : "#" + t;
					tags.push(tag);
					frontmatterTags.push(tag);
				});
			}
		}

		tags = [...new Set(tags)];
		// Create stable ID based on file path and position
		const stableId = `${filePath}:${position.start.line}:${position.start.col}`;
		return {
			id: stableId,
			title: description.trim(),
			status: getTaskStatusFromMarker(statusString),
			category: filePath,
			priority: "medium",
			tags: tags.map((item) => ({ id: item, name: item })),
			extra: {
				rawText: line,
				position: JSON.stringify(position),
				file: filePath,
				marker: statusString,
				frontmatterTags: JSON.stringify(frontmatterTags),
			},
		};
	}
}
