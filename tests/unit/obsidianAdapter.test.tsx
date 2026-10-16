import { render, waitFor } from "@testing-library/react";
import type { Task } from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { ObsidianAdaptor } from "../../src/obsidianAdapter";
import * as obsidian from "../mocks/obsidian";
import { indexFile } from "../helpers/testHelpers";

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
