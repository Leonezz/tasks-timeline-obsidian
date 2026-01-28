import { IconName, ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import React from "react";
import "@tasks-timeline/components/index.css";
import TasksTimelineObsidianPlugin from "main";
import { ObsidianAdaptor } from "./obsidianAdapter";

export const VIEW_TYPE = "tasks-timeline-obsidian";

export class TasksTimelineObsidianView extends ItemView {
	private root: ReactRoot | undefined;
	private plugin: TasksTimelineObsidianPlugin;
	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Tasks Timeline";
	}

	getIcon(): IconName {
		return "calendar-clock";
	}

	constructor(leaf: WorkspaceLeaf, plugin: TasksTimelineObsidianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	protected async onOpen() {
		const { containerEl } = this;
		const container = containerEl.children[1];
		if (!container) {
			console.error("Tasks Timeline: Container element not found");
			return;
		}
		container.empty();
		this.root = createRoot(container);
		this.root.render(
			<React.StrictMode>
				<ObsidianAdaptor plugin={this.plugin} />
			</React.StrictMode>
		);
	}

	protected async onClose() {
		if (this.root) {
			this.root.unmount();
			this.root = undefined;
		}
	}
}
