import { IconName, ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import { TasksTimelineApp } from "@tasks-timeline/components";
import React from "react";
import "@tasks-timeline/components/index.css";

export const VIEW_TYPE = "tasks-timeline-obsidian";

export class TasksTimelineObsidianView extends ItemView {
	private root: ReactRoot | undefined;
	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Tasks Timeline";
	}

	getIcon(): IconName {
		return "calendar-clock";
	}

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	protected async onOpen() {
		const { containerEl } = this;
		const container = containerEl.children[1]!;
		container.empty();
		this.root = createRoot(container);
		this.root.render(
			<React.StrictMode>
				<TasksTimelineApp />
			</React.StrictMode>
		);
		return;
	}
}
