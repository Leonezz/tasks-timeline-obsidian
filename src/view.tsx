import { IconName, ItemView, WorkspaceLeaf } from "obsidian";
import { createRoot, Root as ReactRoot } from "react-dom/client";
import React, { Component, ErrorInfo, ReactNode } from "react";
import componentStyles from "@tasks-timeline/components/index.css?inline";
import pluginStyles from "./styles.css?inline";
import TasksTimelineObsidianPlugin from "main";
import { ObsidianAdaptor } from "./obsidianAdapter";

export const VIEW_TYPE = "tasks-timeline";

/**
 * Helper to safely unmount a React root and return undefined.
 * Used by both view and settings tab for cleanup.
 */
export function unmountReactRoot(root: ReactRoot | undefined): undefined {
	root?.unmount();
	return undefined;
}

interface ErrorBoundaryProps {
	children: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Shows a visible error with a "Try Again" button instead of a blank pane.
 * Shared by the view and the settings tab. "Try Again" remounts the children,
 * so they must read current state on mount rather than values captured
 * when the element was created.
 */
export class TimelineErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
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
		return "Tasks timeline";
	}

	getIcon(): IconName {
		return "calendar-clock";
	}

	constructor(leaf: WorkspaceLeaf, plugin: TasksTimelineObsidianPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	protected async onOpen() {
		const host = this.contentEl;
		host.empty();
		host.addClass("tasks-timeline-view-host");

		const shadowRoot =
			host.shadowRoot ?? host.attachShadow({ mode: "open" });
		const styleEl = host.ownerDocument.createElement("style");
		styleEl.textContent = `${componentStyles}\n${pluginStyles}`;
		const rootEl = host.ownerDocument.createElement("div");
		rootEl.className = "tasks-timeline-app";
		shadowRoot.replaceChildren(styleEl, rootEl);

		this.root = createRoot(rootEl);
		this.root.render(
			<React.StrictMode>
				<TimelineErrorBoundary>
					<ObsidianAdaptor plugin={this.plugin} />
				</TimelineErrorBoundary>
			</React.StrictMode>
		);
	}

	protected async onClose() {
		this.root = unmountReactRoot(this.root);
		this.contentEl.shadowRoot?.replaceChildren();
	}
}
