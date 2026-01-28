import { IconName, ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import React, { Component, ErrorInfo, ReactNode } from "react";
import "@tasks-timeline/components/index.css";
import TasksTimelineObsidianPlugin from "main";
import { ObsidianAdaptor } from "./obsidianAdapter";

export const VIEW_TYPE = "tasks-timeline-obsidian";

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

class TimelineErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("Tasks Timeline crashed:", error, info);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div style={{ padding: "20px", textAlign: "center" }}>
					<h3>Something went wrong in Tasks Timeline</h3>
					<p style={{ color: "var(--text-muted)" }}>
						{this.state.error?.message || "An unexpected error occurred"}
					</p>
					<button
						onClick={() => this.setState({ hasError: false, error: null })}
						style={{
							marginTop: "10px",
							padding: "8px 16px",
							cursor: "pointer",
						}}
					>
						Try Again
					</button>
				</div>
			);
		}
		return this.props.children;
	}
}

export class TasksTimelineObsidianView extends ItemView {
	private root: ReactRoot | undefined;
	private plugin: TasksTimelineObsidianPlugin;
	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		// eslint-disable-next-line obsidianmd/ui/sentence-case -- Plugin name
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
				<TimelineErrorBoundary>
					<ObsidianAdaptor plugin={this.plugin} />
				</TimelineErrorBoundary>
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
