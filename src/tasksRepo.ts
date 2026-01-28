import {
	FrontMatterCache,
	LinkCache,
	ListItemCache,
	Pos,
	SectionCache,
	TagCache,
	TFile,
} from "obsidian";
import { getTaskStatusFromMarker } from "./symbols";
import { TaskRegularExpressions } from "./tasksRegex";
import {
	dailyNoteTaskParser,
	markerBasedStatusParser,
	parseDataViewFormatItem,
	parseTasksFormatItem,
	remainderParser,
	tagsParser,
} from "./parsers";
import { taskToMarkdown } from "./serializers";
import TasksTimelineObsidianPlugin from "./main";
import { Link } from "./link";
import { Task, TaskRepository } from "@tasks-timeline/components";

export class ObsidianTasksRepo implements TaskRepository {
	name: string = "Obsidian Notes";
	plugin: TasksTimelineObsidianPlugin;
	private taskCache = new Map<
		string,
		{ file: string; rawText: string; position: string }
	>();
	private fileTaskCache = new Map<string, Task[]>();

	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;
	}

	invalidateFile(path: string) {
		this.fileTaskCache.delete(path);
	}

	async loadTasks(): Promise<Task[]> {
		// We rebuild the taskCache from fileTaskCache to ensure ID consistency.
		this.taskCache.clear();

		const files = this.plugin.app.vault.getMarkdownFiles();
		const allItems = files.map(async (file) => {
			if (this.fileTaskCache.has(file.path)) {
				return this.fileTaskCache.get(file.path)!;
			}

			const link = Link.file(file.path);
			try {
				const content = await this.plugin.app.vault.cachedRead(file);
				const cache = this.plugin.app.metadataCache.getFileCache(file);
				const tasks =
					cache?.listItems
						?.map(
							this.fromItemCache(
								link,
								file.path,
								content,
								cache.sections,
								cache.links,
								cache.frontmatter,
								cache.tags
							)
						)
						.filter((item): item is Task => !!item) || [];
				
				// Process tasks
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
					}));

				this.fileTaskCache.set(file.path, processedTasks);
				return processedTasks;
			} catch (reason) {
				console.error(`Read file ${file.path} failed:`, reason);
				return [] as Task[];
			}
		});

		const results = await Promise.all(allItems);
		const flattenedTasks = results.flat();

		// Populate ID cache
		flattenedTasks.forEach((task) => {
			if (task.extra?.file && task.extra?.rawText) {
				this.taskCache.set(task.id, {
					file: task.extra.file,
					rawText: task.extra.rawText,
					position: task.extra.position || "",
				});
			}
		});

		return flattenedTasks;
	}

	saveTasks(tasks: Task[]): Promise<void> {
		return Promise.resolve();
	}

	async updateTask(task: Task): Promise<void> {
		if (!task.extra?.file) return;
		const file = this.plugin.app.vault.getAbstractFileByPath(
			task.extra.file
		);
		if (!(file instanceof TFile)) return;

		await this.plugin.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			let lineIndex = -1;
			const storedRawText = task.extra?.rawText;

			// 1. Try to find by position
			if (task.extra?.position) {
				try {
					const pos = JSON.parse(task.extra.position) as Pos;
					// Verify if the line at this position matches the raw text we know
					if (
						lines[pos.start.line] !== undefined &&
						lines[pos.start.line] === storedRawText
					) {
						lineIndex = pos.start.line;
					}
				} catch (e) {
					console.warn("Failed to parse task position", e);
				}
			}

			// 2. Fallback: Find by exact content match
			if (lineIndex === -1 && storedRawText) {
				lineIndex = lines.indexOf(storedRawText);
			}

			if (lineIndex === -1) {
				console.warn(
					"Could not find original task line to update",
					task
				);
				return content;
			}

			// 3. Update the line
			const originalLine = lines[lineIndex];
			if (originalLine) {
				const newLine = taskToMarkdown(task, originalLine);
				lines[lineIndex] = newLine;
			} else {
				console.warn("Original line undefined at index", lineIndex);
			}

			return lines.join("\n");
		});
	}

	async deleteTask(id: string): Promise<void> {
		const cached = this.taskCache.get(id);
		if (!cached) {
			console.warn("Cannot delete task: ID not found in cache", id);
			return;
		}

		const file = this.plugin.app.vault.getAbstractFileByPath(cached.file);
		if (!(file instanceof TFile)) return;

		await this.plugin.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			let lineIndex = -1;

			// 1. Try to find by position
			if (cached.position) {
				try {
					const pos = JSON.parse(cached.position) as Pos;
					if (
						lines[pos.start.line] !== undefined &&
						lines[pos.start.line] === cached.rawText
					) {
						lineIndex = pos.start.line;
					}
				} catch (e) {
					console.warn("Failed to parse task position", e);
				}
			}

			// 2. Fallback: Find by content
			if (lineIndex === -1) {
				lineIndex = lines.indexOf(cached.rawText);
			}

			if (lineIndex === -1) {
				console.warn(
					"Could not find task line to delete",
					cached.rawText
				);
				return content;
			}

			// 3. Delete the line
			lines.splice(lineIndex, 1);

			// Remove from cache to prevent subsequent operations on stale ID
			this.taskCache.delete(id);

			return lines.join("\n");
		});
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
		tagsCache?: TagCache[]
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
						sliceFileContent(parentItem?.position)
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
				tags || []
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
		tags: string[]
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
			TaskRegularExpressions.blockLinkRegex
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
			if (
				frontMatter["tags"] &&
				Array.isArray(frontMatter["tags"])
			) {
				(frontMatter["tags"] as string[]).forEach((t) => {
					const tag = t.startsWith("#") ? t : "#" + t;
					tags.push(tag);
					frontmatterTags.push(tag);
				});
			}
		}

		tags = [...new Set(tags)];
		return {
			id: crypto.randomUUID(),
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
