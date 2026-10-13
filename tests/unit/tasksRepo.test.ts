import type { Task } from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { ObsidianTasksRepo } from "../../src/tasksRepo";
import { App, TFile } from "../mocks/obsidian";
import { indexFile, reindexAfterWrites } from "../helpers/testHelpers";

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
