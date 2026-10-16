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
import {
	filePathOfTaskId,
	isSameTaskLine,
	locateTaskBlock,
	locateTaskLine,
	snapshotOf,
	StaleTaskError,
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

/**
 * Decides whether an edit of a vault task needs a write.
 *
 * Both versions are serialized onto the stored line, so only changes the line
 * can hold count, and a no-op edit (e.g. leaving inline edit mode) neither
 * rewrites nor reformats the line.
 *
 * @returns false when nothing changed; true when the serialized line changes,
 * or when the stored line is unknown (`updateTask` then locates it itself).
 * @throws when the only changes are to fields the vault line cannot store.
 */
export function taskUpdateNeedsWrite(task: Task, previous: Task): boolean {
	const rawText = previous.extra?.rawText;
	if (!rawText) {
		return true;
	}
	if (taskToMarkdown(task, rawText) !== taskToMarkdown(previous, rawText)) {
		return true;
	}

	const unstorable = LINE_UNSTORABLE_FIELDS.filter(
		(field) => (task[field] ?? "").trim() !== (previous[field] ?? "").trim(),
	);
	if (unstorable.length > 0) {
		throw new Error(
			`Cannot update task: ${unstorable.join(" and ")} cannot be stored in the vault line. Only the task line (title, status, priority, dates, tags, recurrence) is saved.`,
		);
	}
	return false;
}

/**
 * Compatibility shim for @tasks-timeline/components <= v0.8.0, whose edit
 * modal saves `recurringInterval: undefined` unless its recurrence switch was
 * touched. Tasks read from the vault carry their 🔁 rule in
 * `recurringInterval` but never set `isRecurring`, so every modal save would
 * erase the rule from the note.
 *
 * Keeps the previous rule when the incoming task has none and no
 * `isRecurring` key at all, which only that untouched switch produces.
 * Explicit removal still clears it: the switch turned off sets
 * `isRecurring: false`, and the AI tools set the `isRecurring` key when they
 * clear a recurrence. Newer modals return the rule unchanged, so this then
 * does nothing.
 */
export function keepRecurrenceDroppedByModal(task: Task, previous: Task): Task {
	const dropped =
		previous.recurringInterval !== undefined &&
		task.recurringInterval === undefined &&
		!("isRecurring" in task);
	return dropped
		? { ...task, recurringInterval: previous.recurringInterval }
		: task;
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
	 * Keeps cached tasks in step with the vault, for consumers that do not
	 * reload on vault events themselves (the MCP server). A modified note is
	 * read only after Obsidian re-indexes it ("changed"): before that its new
	 * content does not match the list item positions in the metadata cache.
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

		const statusMarker = task.status === "done" ? "x" : " ";
		const templateLine = `- [${statusMarker}] ${task.title}`;
		const taskLine = taskToMarkdown(task, templateLine);

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
		return this.readAddedTask(file, insertedLine);
	}

	/**
	 * Re-reads a freshly appended task once Obsidian has indexed the new line.
	 * The task line is appended past the previous end of the file, so a list
	 * item at `line` can only come from the updated metadata.
	 */
	private async readAddedTask(file: TFile, line: number): Promise<Task> {
		await this.waitForTaskItem(file, line);
		this.invalidateFile(file.path);

		// Read only this note: a full load would also replace the snapshots
		// of tasks the caller has not re-read, hiding their staleness.
		const tasks = await this.readFileTasks(file);
		const stored = tasks.find(
			(t) =>
				t.extra?.file === file.path &&
				t.extra?.position !== undefined &&
				(JSON.parse(t.extra.position) as Pos).start.line === line,
		);
		if (!stored) {
			throw new Error(
				`Task was written to ${file.path} (line ${line + 1}) but could not be read back as a task. List tasks to find its id before changing it.`,
			);
		}
		const snapshot = snapshotOf(stored);
		if (snapshot) this.taskCache.set(stored.id, snapshot);
		return stored;
	}

	private waitForTaskItem(file: TFile, line: number): Promise<void> {
		const metadataCache = this.plugin.app.metadataCache;
		const hasTaskItem = () =>
			metadataCache
				.getFileCache(file)
				?.listItems?.some(
					(item) =>
						item.task !== undefined &&
						item.position.start.line === line,
				) ?? false;

		if (hasTaskItem()) return Promise.resolve();

		return new Promise<void>((resolve, reject) => {
			let timer: number | undefined;
			const ref = metadataCache.on("changed", (changedFile) => {
				if (changedFile.path !== file.path || !hasTaskItem()) return;
				window.clearTimeout(timer);
				metadataCache.offref(ref);
				resolve();
			});
			timer = window.setTimeout(() => {
				metadataCache.offref(ref);
				reject(
					new Error(
						`Task was written to ${file.path} (line ${line + 1}) but Obsidian did not index it within ${ADDED_TASK_INDEX_TIMEOUT_MS / 1000}s. List tasks to find its id before changing it.`,
					),
				);
			}, ADDED_TASK_INDEX_TIMEOUT_MS);
		});
	}

	saveTasks(tasks: Task[]): Promise<void> {
		return Promise.resolve();
	}

	/**
	 * Rewrites a task's line. The line must still hold the text this
	 * repository last handed out for the id (or have moved unchanged);
	 * otherwise the id may now name another task and this throws.
	 */
	async updateTask(task: Task): Promise<void> {
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
		const expectedLine = snapshot?.rawText || task.extra?.rawText;
		if (!expectedLine) {
			throw new Error(
				`Cannot update task: ${task.id} was never read from the vault — query tasks again.`,
			);
		}
		const position = snapshot?.position || task.extra?.position;

		const outcome: { writtenLine?: string } = {};
		await this.plugin.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const lineIndex = locateTaskLine(lines, expectedLine, position);
			const originalLine = lines[lineIndex];
			if (originalLine === undefined) {
				return content;
			}
			const newLine = taskToMarkdown(task, originalLine);
			outcome.writtenLine = newLine;
			return [
				...lines.slice(0, lineIndex),
				newLine,
				...lines.slice(lineIndex + 1),
			].join("\n");
		});

		if (outcome.writtenLine === undefined) {
			throw new StaleTaskError(task.id);
		}
		// Remember the written line so a follow-up update of the same task
		// (e.g. leaving inline edit mode) still matches before the next load.
		// Its description lines below were left as they were.
		const descriptionLines = expectedLine.split("\n").slice(1);
		this.taskCache.set(task.id, {
			file: filePath,
			rawText: [outcome.writtenLine, ...descriptionLines].join("\n"),
			position: position ?? "",
		});
		this.invalidateFile(filePath);
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

		const outcome: { expectedContent?: string } = {};
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
			outcome.expectedContent = [
				...lines.slice(0, block.start),
				...lines.slice(block.start + block.count),
			].join("\n");
			return outcome.expectedContent;
		});

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
