import { act } from "@testing-library/react";
import type { WorkspaceLeaf as ObsidianWorkspaceLeaf } from "obsidian";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { TasksTimelineObsidianView } from "../../src/view";
import { WorkspaceLeaf } from "../mocks/obsidian";

jest.mock("../../src/obsidianAdapter", () => ({
	ObsidianAdaptor: () => "timeline app",
}));

interface ViewLifecycle {
	onOpen(): Promise<void>;
	onClose(): Promise<void>;
}

function createView() {
	const view = new TasksTimelineObsidianView(
		new WorkspaceLeaf() as unknown as ObsidianWorkspaceLeaf,
		{} as TasksTimelineObsidianPlugin,
	);
	return { view, lifecycle: view as unknown as ViewLifecycle };
}

describe("TasksTimelineObsidianView", () => {
	it("renders the app into the content element's shadow root", async () => {
		const { view, lifecycle } = createView();

		await act(() => lifecycle.onOpen());

		const { contentEl, containerEl } = view;
		expect(contentEl).toHaveClass("tasks-timeline-view-host");
		expect(
			contentEl.shadowRoot?.querySelector(".tasks-timeline-app")
				?.textContent,
		).toBe("timeline app");
		// The header element is left alone.
		expect(containerEl.children[0]?.shadowRoot).toBeNull();

		await act(() => lifecycle.onClose());
	});

	it("unmounts and clears the shadow root on close", async () => {
		const { view, lifecycle } = createView();
		await act(() => lifecycle.onOpen());

		await act(() => lifecycle.onClose());

		expect(view.contentEl.shadowRoot?.childNodes).toHaveLength(0);
	});
});
