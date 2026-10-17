import { taskToMarkdown, type Task } from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { ObsidianTasksRepo, taskUpdateNeedsWrite } from "../../src/tasksRepo";
import { App, TFile } from "../mocks/obsidian";
import {
	createListItems,
	indexFile,
	reindexAfterWrites,
} from "../helpers/testHelpers";

function createRepo(content: string) {
	const app = new App();
	app.vault._addFile("Tasks.md", content);
	const file = app.vault.getAbstractFileByPath("Tasks.md");
	if (!(file instanceof TFile)) {
		throw new Error("Test file not created");
	}
	indexFile(app, "Tasks.md", content);

	const plugin = {
		app,
		settings: {
			appSetting: {
				defaultCategory: "Tasks.md",
			},
		},
	} as unknown as TasksTimelineObsidianPlugin;

	return {
		app,
		file,
		repo: new ObsidianTasksRepo(plugin),
	};
}

describe("ObsidianTasksRepo.deleteTask", () => {
	it("removes a task only after the write is persisted", async () => {
		const content = "- [ ] Keep\n- [ ] Delete me\n- [ ] Keep too\n";
		const { app, file, repo } = createRepo(content);

		await repo.loadTasks();
		await repo.deleteTask("Tasks.md:1:0");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Keep\n- [ ] Keep too\n",
		);
	});

	it("rejects when Obsidian accepts the process callback but ignores the write", async () => {
		const content = "- [ ] Keep\n- [ ] Delete me\n- [ ] Keep too\n";
		const { app, file, repo } = createRepo(content);
		const originalProcess = app.vault.process.bind(app.vault);
		const processSpy = jest
			.spyOn(app.vault, "process")
			.mockImplementation(async (targetFile, fn) => {
				const existingContent = await app.vault.cachedRead(targetFile);
				fn(existingContent);
			});

		await repo.loadTasks();

		await expect(repo.deleteTask("Tasks.md:1:0")).rejects.toThrow(
			/Cannot delete task: file write was rejected or changed by Obsidian/,
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);

		processSpy.mockImplementation(originalProcess);
		await repo.deleteTask("Tasks.md:1:0");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Keep\n- [ ] Keep too\n",
		);
	});
});

describe("ObsidianTasksRepo.addTask", () => {
	const baseTask: Task = {
		id: "new-task",
		title: "New task",
		status: "todo",
		priority: "medium",
		tags: [],
	};

	it("appends a task to an existing markdown target note", async () => {
		const { app, file, repo } = createRepo("- [ ] Existing\n");
		reindexAfterWrites(app);

		await repo.addTask({
			...baseTask,
			title: "Created by agent",
			category: "Tasks.md",
		});

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Existing\n- [ ] Created by agent\n",
		);
	});

	it("returns the stored task with its file-position id", async () => {
		const { app, repo } = createRepo("- [ ] Existing");
		reindexAfterWrites(app);

		const stored = await repo.addTask({
			...baseTask,
			id: "ai-temporary-id",
			title: "Created by agent",
			category: "Tasks.md",
		});

		expect(stored.id).toBe("Tasks.md:1:0");
		expect(stored.title).toBe("Created by agent");
		expect(app.metadataCache._listenerCount()).toBe(0);
	});

	it("lets the returned id be used for a follow-up update", async () => {
		const { app, file, repo } = createRepo("- [ ] Existing\n");
		reindexAfterWrites(app);

		const stored = await repo.addTask({
			...baseTask,
			title: "Created by agent",
			category: "Tasks.md",
		});
		await repo.updateTask({ ...stored, status: "done" });

		await expect(app.vault.cachedRead(file)).resolves.toMatch(
			/^- \[ \] Existing\n- \[x\] Created by agent/,
		);
	});

	it("rejects with an explicit error when Obsidian never indexes the new line", async () => {
		jest.useFakeTimers();
		try {
			const { app, repo } = createRepo("- [ ] Existing\n");

			const result = repo.addTask({
				...baseTask,
				title: "Never indexed",
				category: "Tasks.md",
			});
			const assertion = expect(result).rejects.toThrow(
				/Task was written to Tasks.md \(line 2\) but Obsidian did not index it/,
			);
			await jest.advanceTimersByTimeAsync(5000);
			await assertion;
			expect(app.metadataCache._listenerCount()).toBe(0);
		} finally {
			jest.useRealTimers();
		}
	});

	it.each([
		[
			"a due date",
			"Pay rent 📅 2026-10-20",
			{},
			"- [ ] Pay rent 📅 2026-10-20",
			{ title: "Pay rent", dueAt: "2026-10-20" },
		],
		[
			"a priority",
			"Fix bug 🔺",
			{},
			"- [ ] Fix bug 🔺",
			{ title: "Fix bug", priority: "high" },
		],
		[
			"a rule and a date",
			"Water plants 🔁 every week 📆 2026-10-20",
			{},
			"- [ ] Water plants 🔁 every week 📆 2026-10-20",
			{ recurringInterval: "every week", dueAt: "2026-10-20" },
		],
		[
			"a created date (over the timeline's default)",
			"Pay rent ➕ 2026-10-01",
			{ createdAt: "2026-10-18T09:00:00.000+08:00" },
			"- [ ] Pay rent ➕ 2026-10-01",
			{ createdAt: "2026-10-01" },
		],
		[
			"a due date the task also sets (the task wins)",
			"Pay rent 📅 2026-10-20",
			{ dueAt: "2026-10-21" },
			"- [ ] Pay rent 📅 2026-10-21",
			{ dueAt: "2026-10-21" },
		],
		[
			"a priority the task also sets (the task wins)",
			"Fix bug 🔽",
			{ priority: "high" },
			"- [ ] Fix bug ⏫",
			{ priority: "high" },
		],
	] as const)(
		"reads %s typed into the title",
		async (_kind, title, fields, line, stored) => {
			const { app, file, repo } = createRepo("- [ ] Existing\n");
			reindexAfterWrites(app);

			const added = await repo.addTask({ ...baseTask, ...fields, title });

			await expect(app.vault.cachedRead(file)).resolves.toBe(
				`- [ ] Existing\n${line}\n`,
			);
			expect(added).toMatchObject(stored);
		},
	);

	it("keeps a 🔁 that runs into other text as typed", async () => {
		const { app, file, repo } = createRepo("- [ ] Existing\n");
		reindexAfterWrites(app);

		const added = await repo.addTask({
			...baseTask,
			title: "Standup 🔁 every day at 9:30",
		});

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Existing\n- [ ] Standup 🔁 every day at 9:30\n",
		);
		expect(added).toMatchObject({
			title: "Standup 🔁 every day at 9:30",
			isRecurring: false,
		});
	});

	it("rejects when the target note does not exist", async () => {
		const { app, repo } = createRepo("- [ ] Existing\n");

		await expect(
			repo.addTask({
				...baseTask,
				title: "Missing target",
				category: "Missing.md",
			}),
		).rejects.toThrow(
			"Cannot add task: target note not found: Missing.md",
		);
		expect(app.vault.getAbstractFileByPath("Missing.md")).toBeNull();
	});
});

describe("taskUpdateNeedsWrite", () => {
	async function loadOnlyTask(line: string): Promise<Task> {
		const { repo } = createRepo(`${line}\n`);
		const [task] = await repo.loadTasks();
		if (!task) {
			throw new Error(`No task parsed from: ${line}`);
		}
		return task;
	}

	it("skips an edit that changes nothing", async () => {
		const previous = await loadOnlyTask("- [ ] Pay rent #home 📅 2026-11-01");

		expect(taskUpdateNeedsWrite({ ...previous }, previous)).toBe(false);
	});

	it("skips a no-op edit and leaves the line as written", async () => {
		const line = "- [ ] #home Pay rent";
		const previous = await loadOnlyTask(line);
		// The line is edited in place: the leading tag stays where it is.
		expect(taskToMarkdown(previous, line)).toBe(line);

		expect(taskUpdateNeedsWrite({ ...previous }, previous)).toBe(false);
	});

	it("treats an empty description as no description", async () => {
		const previous = await loadOnlyTask("- [ ] Pay rent");

		expect(
			taskUpdateNeedsWrite({ ...previous, description: "" }, previous),
		).toBe(false);
	});

	it("writes a tag removal", async () => {
		const previous = await loadOnlyTask("- [ ] Pay rent #home");

		expect(taskUpdateNeedsWrite({ ...previous, tags: [] }, previous)).toBe(
			true,
		);
	});

	it("writes a recurrence-only change", async () => {
		const previous = await loadOnlyTask("- [ ] Water plants 📅 2026-11-01");

		expect(
			taskUpdateNeedsWrite(
				{ ...previous, recurringInterval: "every week" },
				previous,
			),
		).toBe(true);
	});

	it("writes a scheduled-date-only change", async () => {
		const previous = await loadOnlyTask("- [ ] Water plants");

		expect(
			taskUpdateNeedsWrite(
				{
					...previous,
					extra: { ...previous.extra, scheduledAt: "2026-11-02" },
				},
				previous,
			),
		).toBe(true);
	});

	it("writes when the stored line is unknown", async () => {
		const previous = await loadOnlyTask("- [ ] Water plants");
		const withoutLine = { ...previous, extra: undefined };

		expect(taskUpdateNeedsWrite({ ...withoutLine }, withoutLine)).toBe(true);
	});

	it("rejects a description-only change the line cannot store", async () => {
		const previous = await loadOnlyTask("- [ ] Pay rent");

		expect(() =>
			taskUpdateNeedsWrite(
				{ ...previous, description: "Bank transfer" },
				previous,
			),
		).toThrow(/description cannot be stored in the vault line/);
	});

	it("rejects a line change mixed with a description it cannot store", async () => {
		const previous = await loadOnlyTask("- [ ] Pay rent");

		expect(() =>
			taskUpdateNeedsWrite(
				{ ...previous, title: "Pay the rent", description: "Bank transfer" },
				previous,
			),
		).toThrow(/description cannot be stored in the vault line/);
	});

	it("rejects removing a tag the note's frontmatter gives the task", async () => {
		const loaded = await loadOnlyTask("- [ ] Pay rent");
		const previous: Task = {
			...loaded,
			tags: [{ id: "#home", name: "#home" }],
			extra: { ...loaded.extra, frontmatterTags: JSON.stringify(["#home"]) },
		};

		expect(() => taskUpdateNeedsWrite({ ...previous, tags: [] }, previous)).toThrow(
			/frontmatter tag #home cannot be stored in the vault line/,
		);
		expect(() =>
			taskUpdateNeedsWrite(
				{ ...previous, title: "Pay the rent", tags: [] },
				previous,
			),
		).toThrow(/frontmatter tag #home/);
	});

	it("rejects a category-only change the line cannot store", async () => {
		const previous = await loadOnlyTask("- [ ] Pay rent");

		expect(() =>
			taskUpdateNeedsWrite(
				{ ...previous, category: "Other.md" },
				previous,
			),
		).toThrow(/category cannot be stored in the vault line/);
	});
});

describe("ObsidianTasksRepo stale ids", () => {
	async function overwrite(
		app: App,
		file: TFile,
		content: string,
	): Promise<void> {
		await app.vault.modify(file, content);
		indexFile(app, file.path, content);
	}

	it("refuses to update a task whose line now holds another task", async () => {
		const { app, file, repo } = createRepo("- [ ] Old task\n");
		const [task] = await repo.loadTasks();
		await overwrite(app, file, "- [ ] Someone else's task\n");

		await expect(
			repo.updateTask({ ...task!, status: "done" }),
		).rejects.toThrow("Task Tasks.md:0:0 changed since it was read");
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Someone else's task\n",
		);
	});

	it("refuses to delete a task whose line now holds another task", async () => {
		const { app, file, repo } = createRepo("- [ ] Old task\n");
		await repo.loadTasks();
		await overwrite(app, file, "- [ ] Someone else's task\n");

		await expect(repo.deleteTask("Tasks.md:0:0")).rejects.toThrow(
			"changed since it was read",
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Someone else's task\n",
		);
	});

	it("applies a second update of the same task before a reload (leaving edit mode)", async () => {
		const { app, file, repo } = createRepo("- [ ] Draft\n");
		const [task] = await repo.loadTasks();

		// Both calls carry the task as first loaded, like the timeline does.
		await repo.updateTask({ ...task!, title: "Draft title" });
		await repo.updateTask({ ...task!, title: "Final title" });

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Final title\n",
		);
	});

	it("updates an unchanged task that moved down a line", async () => {
		const { app, file, repo } = createRepo("- [ ] Pay rent\n");
		const [task] = await repo.loadTasks();
		await overwrite(app, file, "# Inbox\n- [ ] Pay rent\n");

		await repo.updateTask({ ...task!, status: "done" });

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"# Inbox\n- [x] Pay rent\n",
		);
	});

	it("refuses when the moved line is ambiguous", async () => {
		const { app, file, repo } = createRepo("- [ ] Pay rent\n");
		const [task] = await repo.loadTasks();
		const content = "# Inbox\n- [ ] Pay rent\n- [ ] Pay rent\n";
		await overwrite(app, file, content);

		await expect(
			repo.updateTask({ ...task!, status: "done" }),
		).rejects.toThrow("changed since it was read");
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);
	});

	it("reads its own update back", async () => {
		const { app, repo } = createRepo("- [ ] Draft\n");
		reindexAfterWrites(app);
		const [task] = await repo.loadTasks();

		await repo.updateTask({ ...task!, title: "Renamed" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		const [reloaded] = await repo.loadTasks();
		expect(reloaded?.title).toBe("Renamed");
	});

	it("keeps ids resolvable while a reload is in progress", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] Keep\n- [ ] Delete me\n",
		);
		await repo.loadTasks();
		repo.invalidateFile("Tasks.md");
		const originalCachedRead = app.vault.cachedRead.bind(app.vault);
		let releaseRead: () => void = () => undefined;
		const readGate = new Promise<void>((resolve) => {
			releaseRead = resolve;
		});
		const readSpy = jest
			.spyOn(app.vault, "cachedRead")
			.mockImplementationOnce(async (target) => {
				await readGate;
				return originalCachedRead(target);
			});

		const reload = repo.loadTasks();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(readSpy).toHaveBeenCalledTimes(1);

		await repo.deleteTask("Tasks.md:1:0");
		releaseRead();
		await reload;

		await expect(app.vault.cachedRead(file)).resolves.toBe("- [ ] Keep\n");
	});
});

describe.each([
	{
		kind: "callout",
		content: "> [!todo] Inbox\n> - [ ] Quoted task\n",
		before: "> [!todo] Inbox\n",
		quote: "> ",
	},
	{
		kind: "nested blockquote",
		content: "> > - [ ] Quoted task\n",
		before: "",
		quote: "> > ",
	},
])("ObsidianTasksRepo with a $kind task", ({ content, before, quote }) => {
	it("toggles it", async () => {
		const { app, file, repo } = createRepo(content);
		const [task] = await repo.loadTasks();

		await repo.updateTask({ ...task!, status: "done" });

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			`${before}${quote}- [x] Quoted task\n`,
		);
	});

	it("edits it", async () => {
		const { app, file, repo } = createRepo(content);
		const [task] = await repo.loadTasks();

		await repo.updateTask({ ...task!, title: "Renamed" });

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			`${before}${quote}- [ ] Renamed\n`,
		);
	});

	it("deletes it", async () => {
		const { app, file, repo } = createRepo(content);
		const [task] = await repo.loadTasks();

		await repo.deleteTask(task!.id);

		await expect(app.vault.cachedRead(file)).resolves.toBe(before);
	});
});

describe("ObsidianTasksRepo multi-line tasks", () => {
	it("deletes a task together with its description lines", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] Keep\n- [ ] With notes\n\tFirst detail\n\tSecond detail\n- [ ] After\n",
		);
		await repo.loadTasks();

		await repo.deleteTask("Tasks.md:1:0");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Keep\n- [ ] After\n",
		);
	});

	it("deletes a quoted task together with its description lines", async () => {
		const { app, file, repo } = createRepo(
			"> - [ ] Quoted\n> \tDetails\n> - [ ] Next\n",
		);
		await repo.loadTasks();

		await repo.deleteTask("Tasks.md:0:2");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"> - [ ] Next\n",
		);
	});

	it("deletes a task that addTask created with a description", async () => {
		const { app, file, repo } = createRepo("- [ ] Existing\n");
		reindexAfterWrites(app);
		const stored = await repo.addTask({
			id: "new-task",
			title: "Call the bank",
			description: "Ask about fees",
			status: "todo",
			priority: "medium",
			tags: [],
			category: "Tasks.md",
		});
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Existing\n- [ ] Call the bank\n\tAsk about fees\n",
		);

		await repo.deleteTask(stored.id);

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Existing\n",
		);
	});

	it("deletes a described task updated since the last load", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] With notes\n\tDetails\n- [ ] After\n",
		);
		const [task] = await repo.loadTasks();

		await repo.updateTask({ ...task!, status: "done" });
		await repo.deleteTask(task!.id);

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] After\n",
		);
	});

	it("refuses to delete a multi-line task whose description changed", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] With notes\n\tOld detail\n",
		);
		await repo.loadTasks();
		const edited = "- [ ] With notes\n\tNew detail\n";
		await app.vault.modify(file, edited);
		indexFile(app, "Tasks.md", edited);

		await expect(repo.deleteTask("Tasks.md:0:0")).rejects.toThrow(
			"changed since it was read",
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(edited);
	});

	it.each([
		[
			"an indented description line",
			"- [ ] Keep\n- [ ] With notes\n\tDetails\n- [ ] After\n",
			"- [ ] Keep\n- [ ] With notes\n\tDetails\n\tAdded later\n- [ ] After\n",
		],
		[
			"a first description line",
			"- [ ] Keep\n- [ ] Plain\n- [ ] After\n",
			"- [ ] Keep\n- [ ] Plain\n\tAdded later\n- [ ] After\n",
		],
		[
			"a lazy continuation line",
			"- [ ] Keep\n- [ ] Plain\n",
			"- [ ] Keep\n- [ ] Plain\nadded later\n",
		],
		[
			"a callout description line",
			"> [!todo] Inbox\n> - [ ] Keep\n> - [ ] Quoted\n",
			"> [!todo] Inbox\n> - [ ] Keep\n> - [ ] Quoted\n> \tAdded later\n",
		],
	])(
		"refuses to delete a task that gained %s since it was read",
		async (_kind, content, edited) => {
			const { app, file, repo } = createRepo(content);
			const tasks = await repo.loadTasks();
			await app.vault.modify(file, edited);
			indexFile(app, "Tasks.md", edited);

			await expect(repo.deleteTask(tasks[1]!.id)).rejects.toThrow(
				"changed since it was read",
			);
			await expect(app.vault.cachedRead(file)).resolves.toBe(edited);
		},
	);

	it("deletes a task followed by a heading", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] Keep\n- [ ] Delete me\n# Next section\n",
		);
		await repo.loadTasks();

		await repo.deleteTask("Tasks.md:1:0");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Keep\n# Next section\n",
		);
	});

	it("deletes a task followed by a %% comment block", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] Keep\n- [ ] Delete me\n%%\nhidden note\n%%\n",
		);
		const tasks = await repo.loadTasks();
		expect(tasks[1]?.extra?.rawText).toBe("- [ ] Delete me");

		await repo.deleteTask("Tasks.md:1:0");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Keep\n%%\nhidden note\n%%\n",
		);
	});
});

describe("ObsidianTasksRepo with a copy read before a reload", () => {
	it("refuses to write a stale copy over the task now on its line", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] Pay rent\n- [ ] Water plants 🔁 every day\n",
		);
		const [editorCopy] = await repo.loadTasks();
		// "Pay rent" is deleted in the editor; the timeline reloads.
		const changed = "- [ ] Water plants 🔁 every day\n";
		await app.vault.modify(file, changed);
		indexFile(app, "Tasks.md", changed);
		repo.invalidateFile("Tasks.md");
		await repo.loadTasks();

		await expect(
			repo.updateTask({ ...editorCopy!, status: "done" }),
		).rejects.toThrow("Task Tasks.md:0:0 changed since it was read");
		await expect(app.vault.cachedRead(file)).resolves.toBe(changed);
	});
});

describe("ObsidianTasksRepo deleting a task with sub-tasks", () => {
	it.each([
		["spaces", "- [ ] Parent\n    - [ ] Child\n- [ ] After\n", "Tasks.md:0:0"],
		["tabs", "- [ ] Parent\n\t- [ ] Child\n- [ ] After\n", "Tasks.md:0:0"],
		["a callout", "> [!todo] Inbox\n> - [ ] Parent\n> \t- [ ] Child\n", "Tasks.md:1:2"],
		["a description and a sub-task", "- [ ] Parent\n\tNotes\n\t- [ ] Child\n", "Tasks.md:0:0"],
		["a plain sub-bullet", "- [ ] Parent\n\t- A note\n", "Tasks.md:0:0"],
		["a blank line before the sub-task", "- [ ] Parent\n\n\t- [ ] Child\n", "Tasks.md:0:0"],
	])("refuses when it has nested items (%s)", async (_kind, content, id) => {
		const { app, file, repo } = createRepo(content);
		await repo.loadTasks();

		await expect(repo.deleteTask(id)).rejects.toThrow(
			"Cannot delete task: it has sub-tasks or other nested items — delete or move them first.",
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);
	});

	it("refuses when a paragraph comes before the sub-task", async () => {
		const content = "- [ ] Parent\n\n\tSome notes\n\n\t- [ ] Child\n";
		const { app, file, repo } = createRepo(content);
		// Like Obsidian's index, the parent's item spans the indented
		// paragraph after the blank line (see continuesItem in taskLine.ts).
		const [parent, ...others] = createListItems(content);
		const paragraphEnd =
			content.indexOf("\tSome notes") + "\tSome notes".length;
		app.metadataCache._setCache("Tasks.md", {
			listItems: [
				{
					...parent!,
					position: {
						start: parent!.position.start,
						end: { line: 2, col: "\tSome notes".length, offset: paragraphEnd },
					},
				},
				...others,
			],
			sections: [],
			links: [],
			tags: [],
		});
		await repo.loadTasks();

		await expect(repo.deleteTask("Tasks.md:0:0")).rejects.toThrow(
			"Cannot delete task: it has sub-tasks or other nested items — delete or move them first.",
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);
	});

	it("still deletes the sub-task itself", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] Parent\n\t- [ ] Child\n- [ ] After\n",
		);
		await repo.loadTasks();

		await repo.deleteTask("Tasks.md:1:1");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Parent\n- [ ] After\n",
		);
	});

	it("deletes a task followed by a less indented sibling", async () => {
		const { app, file, repo } = createRepo(
			"- [ ] Parent\n\t- [ ] Child\n- [ ] After\n",
		);
		await repo.loadTasks();

		await repo.deleteTask("Tasks.md:2:0");

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Parent\n\t- [ ] Child\n",
		);
	});
});

describe("ObsidianTasksRepo with Dataview inline fields", () => {
	async function loadOnly(content: string) {
		const { app, file, repo } = createRepo(content);
		const [task] = await repo.loadTasks();
		if (!task) throw new Error(`No task parsed from: ${content}`);
		return { app, file, repo, task };
	}

	const IN_TITLE = "- [ ] Task [[project:: Alpha]] [[due:: 2026-10-25]]\n";
	const AFTER_FIELDS = "- [ ] Task ➕ 2026-10-01 [[due:: 2026-10-25]]\n";

	it("reads a field after the Tasks fields (extra.lineNotes)", async () => {
		const { task } = await loadOnly(AFTER_FIELDS);

		expect(task).toMatchObject({ title: "Task", dueAt: "2026-10-25" });
		expect(task.extra?.lineNotes).toBe("[[due:: 2026-10-25]]");
	});

	it.each([
		[
			"completes a task, keeping fields in the title",
			IN_TITLE,
			{ status: "done", completedAt: "2026-10-17" },
			"- [x] Task [[project:: Alpha]] [[due:: 2026-10-25]] ✅ 2026-10-17\n",
		],
		[
			"completes a task, keeping fields after the Tasks fields",
			AFTER_FIELDS,
			{ status: "done", completedAt: "2026-10-17" },
			"- [x] Task ➕ 2026-10-01 ✅ 2026-10-17 [[due:: 2026-10-25]]\n",
		],
		[
			"renames a task, keeping the fields in its title",
			IN_TITLE,
			{ title: "Task renamed" },
			"- [ ] Task renamed [[project:: Alpha]] [[due:: 2026-10-25]]\n",
		],
		[
			"changes a due date in its Dataview field (title)",
			IN_TITLE,
			{ dueAt: "2026-10-30" },
			"- [ ] Task [[project:: Alpha]] [[due:: 2026-10-30]]\n",
		],
		[
			"changes a due date in its Dataview field (after the fields)",
			AFTER_FIELDS,
			{ dueAt: "2026-10-30" },
			"- [ ] Task ➕ 2026-10-01 [[due:: 2026-10-30]]\n",
		],
		[
			"removes the Dataview field of a cleared due date",
			IN_TITLE,
			{ dueAt: undefined },
			"- [ ] Task [[project:: Alpha]]\n",
		],
		[
			"keeps a 📅 date the Dataview field overrides",
			"- [ ] Task 📅 2026-10-20 [[due:: 2026-10-25]]\n",
			{ status: "done", completedAt: "2026-10-17" },
			"- [x] Task 📅 2026-10-20 ✅ 2026-10-17 [[due:: 2026-10-25]]\n",
		],
		[
			"removes a tag next to a Dataview field",
			"- [ ] Pay #home rent [[due:: 2026-10-25]]\n",
			{ tags: [] },
			"- [ ] Pay rent [[due:: 2026-10-25]]\n",
		],
		[
			"keeps a tag inside a Dataview field",
			"- [ ] Task [[project:: #alpha]] [[due:: 2026-10-25]]\n",
			{ dueAt: "2026-10-30" },
			"- [ ] Task [[project:: #alpha]] [[due:: 2026-10-30]]\n",
		],
		[
			"reopens a task completed in a Dataview field",
			"- [x] Task [[completion:: 2026-10-17]]\n",
			{ status: "todo", completedAt: undefined },
			"- [ ] Task\n",
		],
	] as [string, string, Partial<Task>, string][])(
		"%s",
		async (_case, content, changes, expected) => {
			const { app, file, repo, task } = await loadOnly(content);
			const edited: Task = { ...task, ...changes };

			expect(taskUpdateNeedsWrite(edited, task)).toBe(true);
			await repo.updateTask(edited);

			await expect(app.vault.cachedRead(file)).resolves.toBe(expected);
		},
	);

	it.each([IN_TITLE, AFTER_FIELDS])(
		"needs no write for an edit that changes nothing (%j)",
		async (content) => {
			const { task } = await loadOnly(content);

			expect(taskUpdateNeedsWrite({ ...task }, task)).toBe(false);
		},
	);

	it("reads its own write back with the same fields", async () => {
		const { app, repo, task } = await loadOnly(IN_TITLE);
		reindexAfterWrites(app);

		await repo.updateTask({ ...task, dueAt: "2026-10-30" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		const [reloaded] = await repo.loadTasks();
		expect(reloaded).toMatchObject({ title: "Task", dueAt: "2026-10-30" });
	});
});
