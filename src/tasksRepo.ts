import { Task, TaskRepository } from "@tasks-timeline/components";
import { randomUUID } from "crypto";
import { getFileTitle, Link } from "./link";
import TasksTimelineObsidianPlugin from "main";
import {
	FrontMatterCache,
	LinkCache,
	ListItemCache,
	Pos,
	SectionCache,
	TagCache,
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

export class ObsidianTasksRepo implements TaskRepository {
	name: string = "Obsidian Notes";
	plugin: TasksTimelineObsidianPlugin;
	constructor(plugin: TasksTimelineObsidianPlugin) {
		this.plugin = plugin;
	}
	loadTasks(): Promise<Task[]> {
		const files = this.plugin.app.vault.getMarkdownFiles();
		const allItems = files.flatMap((file, index, all) => {
			const link = Link.file(file.path);
			const items = this.plugin.app.vault
				.cachedRead(file)
				.then((content) => {
					const cache =
						this.plugin.app.metadataCache.getFileCache(file);
					return (
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
							.filter((item) => !!item) || ([] as Task[])
					);
				})
				.catch((reason) => {
					console.error("read file from obsidian failed: ", reason);
					return [] as Task[];
				});
			return items;
		});
		return Promise.all(allItems)
			.then((items) => items.flat())
			.then((items) => {
				return items
					.map(parseTasksFormatItem)
					.map(parseDataViewFormatItem)
					.map(dailyNoteTaskParser())
					.map(remainderParser)
					.map(tagsParser)
					.map(markerBasedStatusParser);
			});
	}
	saveTasks(tasks: Task[]): Promise<void> {
		console.log("save tasks: ", tasks);
		return Promise.resolve();
	}
	updateTask(task: Task): Promise<void> {
		console.log("update task: ", task);
		return Promise.resolve();
	}
	deleteTask(id: string): Promise<void> {
		console.log("delete tasks: ", id);
		return Promise.resolve();
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
		frontMatter: Record<string, string> | undefined,
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
		const listMarker = regexMatch[2]!; // - for - [ ]

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

		if (frontMatter) {
			if (frontMatter["tag"] && typeof frontMatter["tag"] === "string") {
				// add # as prefix if there is not such prefix
				// But it seems unnecessary to judge cuz in obsidian # prefix is not allowed for the frontmatter tags
				const frontmatterTagPrefix = frontMatter["tag"].startsWith("#")
					? ""
					: "#";
				tags.push(frontmatterTagPrefix + frontMatter["tag"]);
			}
			if (
				frontMatter["tags"] &&
				typeof frontMatter["tags"] === typeof new Array<string>()
			) {
				// add # as prefix if there is not such prefix
				(frontMatter["tags"] as unknown as Array<string>).forEach((t) =>
					tags.push(t.startsWith("#") ? "" : "#" + t)
				);
			}
		}

		tags = [...new Set(tags)];
		return {
			id: randomUUID(),
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
			},
		};
	}
}
