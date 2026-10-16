import { render, waitFor } from "@testing-library/react";
import type { Task } from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { ObsidianAdaptor } from "../../src/obsidianAdapter";
import * as obsidian from "../mocks/obsidian";
import { editExternally, indexFile } from "../helpers/testHelpers";

interface CapturedAppProps {
	tasks: Task[];
	onTaskUpdated: (task: Task, previous: Task) => Promise<void>;
	onTaskDeleted: (taskId: string, previous: Task) => Promise<void>;
}

let mockAppProps: CapturedAppProps | undefined;

jest.mock("@tasks-timeline/components", () => ({
	...jest.requireActual("@tasks-timeline/components"),
	TasksTimelineApp: (props: CapturedAppProps) => {
		mockAppProps = props;
		return null;
	},
}));

jest.mock("../../src/obsidianDom", () => ({
	getActiveWindow: () => window,
	getActiveDocument: () => document,
}));

async function renderAdaptor(content: string) {
	const app = new obsidian.App();
	app.vault._addFile("Tasks.md", content);
	indexFile(app, "Tasks.md", content);
	const file = app.vault.getAbstractFileByPath("Tasks.md");
	if (!(file instanceof obsidian.TFile)) {
		throw new Error("Test file not created");
	}

	const plugin = {
		app,
		settings: {
			systemInDarkMode: false,
			appSetting: { defaultCategory: "Tasks.md" },
		},
		bus: { on: () => () => undefined, emit: () => undefined },
	} as unknown as TasksTimelineObsidianPlugin;

	render(<ObsidianAdaptor plugin={plugin} />);
	await waitFor(() => expect(mockAppProps?.tasks.length).toBeGreaterThan(0));
	const props = mockAppProps!;
	return { app, file, props, previous: props.tasks[0]! };
}

describe("ObsidianAdaptor task handlers", () => {
	let noticeSpy: jest.SpyInstance;

	beforeEach(() => {
		mockAppProps = undefined;
		noticeSpy = jest
			.spyOn(obsidian, "Notice")
			.mockImplementation(
				(message: string) => ({ message }) as obsidian.Notice,
			);
	});

	afterEach(() => {
		noticeSpy.mockRestore();
	});

	it("rejects and shows the reason when the vault write fails", async () => {
		const { app, previous } = await renderAdaptor("- [ ] Pay rent\n");
		jest.spyOn(app.vault, "process").mockRejectedValue(
			new Error("disk full"),
		);

		await expect(
			mockAppProps!.onTaskUpdated(
				{ ...previous, title: "Pay rent today" },
				previous,
			),
		).rejects.toThrow("disk full");
		expect(noticeSpy).toHaveBeenCalledWith(
			"Failed to update task: disk full",
		);
	});

	it("rejects a description-only edit instead of dropping it", async () => {
		const { app, file, previous } = await renderAdaptor("- [ ] Pay rent\n");

		await expect(
			mockAppProps!.onTaskUpdated(
				{ ...previous, description: "Bank transfer" },
				previous,
			),
		).rejects.toThrow(/description cannot be stored in the vault line/);
		expect(noticeSpy).toHaveBeenCalledWith(
			expect.stringMatching(
				/^Failed to update task: .*description cannot be stored/,
			),
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Pay rent\n",
		);
	});

	it("writes a tag removal", async () => {
		const { app, file, previous } = await renderAdaptor(
			"- [ ] Pay rent #home\n",
		);

		await mockAppProps!.onTaskUpdated({ ...previous, tags: [] }, previous);

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Pay rent\n",
		);
		expect(noticeSpy).not.toHaveBeenCalled();
	});

	it("does not touch the file for an edit that changes nothing", async () => {
		const { app, previous } = await renderAdaptor("- [ ] Pay rent\n");
		const processSpy = jest.spyOn(app.vault, "process");

		await mockAppProps!.onTaskUpdated({ ...previous }, previous);

		expect(processSpy).not.toHaveBeenCalled();
	});

	describe("with a task inside a callout", () => {
		const CALLOUT = "> [!todo] Inbox\n> - [ ] Quoted task\n";

		it("toggles it", async () => {
			const { app, file, previous } = await renderAdaptor(CALLOUT);

			await mockAppProps!.onTaskUpdated(
				{ ...previous, status: "done" },
				previous,
			);

			await expect(app.vault.cachedRead(file)).resolves.toBe(
				"> [!todo] Inbox\n> - [x] Quoted task\n",
			);
		});

		it("edits it", async () => {
			const { app, file, previous } = await renderAdaptor(CALLOUT);

			await mockAppProps!.onTaskUpdated(
				{ ...previous, title: "Renamed" },
				previous,
			);

			await expect(app.vault.cachedRead(file)).resolves.toBe(
				"> [!todo] Inbox\n> - [ ] Renamed\n",
			);
		});

		it("deletes it", async () => {
			const { app, file, previous } = await renderAdaptor(CALLOUT);

			await mockAppProps!.onTaskDeleted(previous.id, previous);

			await expect(app.vault.cachedRead(file)).resolves.toBe(
				"> [!todo] Inbox\n",
			);
		});
	});

	describe("with a recurring task (components <= v0.8.0 edit modal)", () => {
		const RECURRING = "- [ ] Water plants 📅 2026-10-16 🔁 every day\n";

		// What v0.8.0's modal saves when its recurrence switch is untouched.
		const savedByModal = (task: Task, changes: Partial<Task> = {}) => ({
			...task,
			...changes,
			recurringInterval: undefined,
		});

		it("keeps 🔁 on a modal save that changes nothing", async () => {
			const { app, file, previous } = await renderAdaptor(RECURRING);
			const processSpy = jest.spyOn(app.vault, "process");

			await mockAppProps!.onTaskUpdated(savedByModal(previous), previous);

			expect(processSpy).not.toHaveBeenCalled();
			await expect(app.vault.cachedRead(file)).resolves.toBe(RECURRING);
		});

		it("keeps 🔁 on a modal save that only changes tags", async () => {
			const { app, file, previous } = await renderAdaptor(RECURRING);

			await mockAppProps!.onTaskUpdated(
				savedByModal(previous, {
					tags: [{ id: "#home", name: "#home" }],
				}),
				previous,
			);

			await expect(app.vault.cachedRead(file)).resolves.toBe(
				"- [ ] Water plants #home 📅 2026-10-16 🔁 every day\n",
			);
		});

		it("keeps 🔁 on a modal save that only changes the description", async () => {
			const { app, file, previous } = await renderAdaptor(RECURRING);

			await expect(
				mockAppProps!.onTaskUpdated(
					savedByModal(previous, { description: "Use rain water" }),
					previous,
				),
			).rejects.toThrow(/description cannot be stored/);
			await expect(app.vault.cachedRead(file)).resolves.toBe(RECURRING);
		});

		it("clears 🔁 when the modal's recurrence switch is turned off", async () => {
			const { app, file, previous } = await renderAdaptor(RECURRING);

			await mockAppProps!.onTaskUpdated(
				savedByModal(previous, { isRecurring: false }),
				previous,
			);

			await expect(app.vault.cachedRead(file)).resolves.toBe(
				"- [ ] Water plants 📅 2026-10-16\n",
			);
		});

		it("clears 🔁 when the in-app AI clears the recurrence", async () => {
			const { app, file, previous } = await renderAdaptor(RECURRING);

			// v0.8.0 update_task with recurrence "".
			await mockAppProps!.onTaskUpdated(
				{ ...previous, isRecurring: undefined, recurringInterval: undefined },
				previous,
			);

			await expect(app.vault.cachedRead(file)).resolves.toBe(
				"- [ ] Water plants 📅 2026-10-16\n",
			);
		});
	});

	describe("when the note changed since the timeline loaded", () => {
		const changeNote = async (
			app: obsidian.App,
			file: obsidian.TFile,
			content: string,
		) => {
			await app.vault.modify(file, content);
			indexFile(app, file.path, content);
		};

		it("asks the user to retry and refreshes the timeline", async () => {
			const { app, file, previous } = await renderAdaptor("- [ ] Pay rent\n");
			await changeNote(app, file, "- [ ] Pay the rent today\n");

			await expect(
				mockAppProps!.onTaskUpdated(
					{ ...previous, status: "done" },
					previous,
				),
			).rejects.toThrow("changed since it was read — query tasks again");
			expect(noticeSpy).toHaveBeenCalledWith(
				"Failed to update task: this note changed in the editor; the timeline is refreshing — reopen the task and try again.",
			);
			await waitFor(() =>
				expect(mockAppProps?.tasks[0]?.title).toBe("Pay the rent today"),
			);
		});

		it("does the same for a delete", async () => {
			const { app, file, previous } = await renderAdaptor("- [ ] Pay rent\n");
			await changeNote(app, file, "- [ ] Pay the rent today\n");

			await expect(
				mockAppProps!.onTaskDeleted(previous.id, previous),
			).rejects.toThrow("changed since it was read");
			expect(noticeSpy).toHaveBeenCalledWith(
				"Failed to delete task: this note changed in the editor; the timeline is refreshing — reopen the task and try again.",
			);
			await expect(app.vault.cachedRead(file)).resolves.toBe(
				"- [ ] Pay the rent today\n",
			);
		});
	});

	it("refuses to save an editor copy opened before the timeline reloaded", async () => {
		const { app, file, previous: editorCopy } = await renderAdaptor(
			"- [ ] Pay rent\n- [ ] Water plants 🔁 every day\n",
		);
		// "Pay rent" is deleted in the editor; the timeline reloads, so its id
		// now names "Water plants".
		const changed = "- [ ] Water plants 🔁 every day\n";
		await editExternally(app, "Tasks.md", changed);
		app.metadataCache.trigger("resolved");
		await waitFor(
			() => expect(mockAppProps?.tasks[0]?.title).toBe("Water plants"),
			{ timeout: 2000 },
		);
		const current = mockAppProps!.tasks[0]!;

		// v0.8.0's modal saves the copy with its recurrence switch untouched.
		await expect(
			mockAppProps!.onTaskUpdated(
				{ ...editorCopy, status: "done", recurringInterval: undefined },
				current,
			),
		).rejects.toThrow("changed since it was read");
		expect(noticeSpy).toHaveBeenCalledWith(
			"Failed to update task: this note changed in the editor; the timeline is refreshing — reopen the task and try again.",
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(changed);
	});

	it("applies a second edit of the same task before the timeline reloads", async () => {
		const { app, file, previous } = await renderAdaptor("- [ ] Draft\n");

		await mockAppProps!.onTaskUpdated(
			{ ...previous, title: "Draft title" },
			previous,
		);
		const afterFirst = mockAppProps!.tasks[0]!;
		await mockAppProps!.onTaskUpdated(
			{ ...afterFirst, title: "Final title" },
			afterFirst,
		);

		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Final title\n",
		);
	});

	describe("editing a task again after the timeline's own write", () => {
		// Obsidian re-indexes the written note and the timeline reloads.
		async function reloadTimeline(
			app: obsidian.App,
			file: obsidian.TFile,
			shown: Task,
		): Promise<Task> {
			indexFile(app, file.path, await app.vault.cachedRead(file));
			app.metadataCache.trigger("resolved");
			await waitFor(() => expect(mockAppProps?.tasks[0]).not.toBe(shown), {
				timeout: 2000,
			});
			return mockAppProps!.tasks[0]!;
		}

		async function editInTimeline(previous: Task, changes: Partial<Task>) {
			await mockAppProps!.onTaskUpdated({ ...previous, ...changes }, previous);
			await waitFor(() => expect(mockAppProps?.tasks[0]).not.toBe(previous));
			return mockAppProps!.tasks[0]!;
		}

		const cases: [string, Partial<Task>, Partial<Task>, string][] = [
			[
				"a rename, then a due date",
				{ title: "Draft title" },
				{ dueAt: "2026-10-20" },
				"- [ ] Draft title 📅 2026-10-20\n",
			],
			[
				"a priority, then a rename",
				{ priority: "high" },
				{ title: "Renamed" },
				"- [ ] Renamed ⏫\n",
			],
		];

		it.each(cases)(
			"saves an editor copy taken before the reload, after it (%s)",
			async (_case, first, second, expected) => {
				const { app, file, previous } = await renderAdaptor("- [ ] Draft\n");
				const editorCopy = await editInTimeline(previous, first);
				const current = await reloadTimeline(app, file, editorCopy);

				await mockAppProps!.onTaskUpdated(
					{ ...editorCopy, ...second },
					current,
				);

				await expect(app.vault.cachedRead(file)).resolves.toBe(expected);
				expect(noticeSpy).not.toHaveBeenCalled();
			},
		);

		it.each(cases)(
			"saves an editor copy before the reload (%s)",
			async (_case, first, second, expected) => {
				const { app, file, previous } = await renderAdaptor("- [ ] Draft\n");
				const editorCopy = await editInTimeline(previous, first);

				await mockAppProps!.onTaskUpdated(
					{ ...editorCopy, ...second },
					editorCopy,
				);

				await expect(app.vault.cachedRead(file)).resolves.toBe(expected);
				expect(noticeSpy).not.toHaveBeenCalled();
			},
		);

		it("keeps its copy in the form a reload reads it (callout)", async () => {
			const { app, file, previous } = await renderAdaptor(
				"> - [ ] Quoted\n> \tDetails\n",
			);
			const shown = await editInTimeline(previous, { title: "Renamed" });

			const reloaded = await reloadTimeline(app, file, shown);

			expect(shown.extra?.rawText).toBe(reloaded.extra?.rawText);
		});
	});

	it("refuses to delete a task with sub-tasks", async () => {
		const content = "- [ ] Parent\n\t- [ ] Child\n";
		const { app, file, previous } = await renderAdaptor(content);

		await expect(
			mockAppProps!.onTaskDeleted(previous.id, previous),
		).rejects.toThrow("it has sub-tasks");
		expect(noticeSpy).toHaveBeenCalledWith(
			"Failed to delete task: Cannot delete task: it has sub-tasks or other nested items — delete or move them first.",
		);
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);
	});

	it("rejects and shows the reason when a delete fails", async () => {
		const { previous } = await renderAdaptor("- [ ] Pay rent\n");

		await expect(
			mockAppProps!.onTaskDeleted("Missing.md:0:0", previous),
		).rejects.toThrow("ID not found in cache");
		expect(noticeSpy).toHaveBeenCalledWith(
			"Failed to delete task: Cannot delete task: ID not found in cache: Missing.md:0:0",
		);
	});
});
