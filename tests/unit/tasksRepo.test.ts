import type TasksTimelineObsidianPlugin from "../../src/main";
import { ObsidianTasksRepo } from "../../src/tasksRepo";
import { App, TFile, type ListItemCache } from "../mocks/obsidian";

function createListItems(content: string): ListItemCache[] {
	let offset = 0;
	return content.split("\n").flatMap((line, lineNumber) => {
		const startOffset = offset;
		offset += line.length + 1;

		if (!/^- \[[^\]]\] /.test(line)) {
			return [];
		}

		return [
			{
				position: {
					start: { line: lineNumber, col: 0, offset: startOffset },
					end: {
						line: lineNumber,
						col: line.length,
						offset: startOffset + line.length,
					},
				},
				parent: -1,
				task: line.slice(3, 4),
			},
		];
	});
}

function createRepo(content: string) {
	const app = new App();
	app.vault._addFile("Tasks.md", content);
	const file = app.vault.getAbstractFileByPath("Tasks.md");
	if (!(file instanceof TFile)) {
		throw new Error("Test file not created");
	}
	app.metadataCache._setCache("Tasks.md", {
		listItems: createListItems(content),
		sections: [],
		links: [],
		tags: [],
	});

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
