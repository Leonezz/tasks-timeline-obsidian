import type { App } from "obsidian";

interface WorkspaceWithActiveDom {
	activeDocument?: Document;
	activeWindow?: Window;
}

function getWorkspaceDom(app: App): WorkspaceWithActiveDom {
	return app.workspace as unknown as WorkspaceWithActiveDom;
}

export function getActiveDocument(app: App): Document {
	return getWorkspaceDom(app).activeDocument ?? app.workspace.containerEl.doc;
}

export function getActiveWindow(app: App): Window {
	return (
		getWorkspaceDom(app).activeWindow ??
		app.workspace.containerEl.win
	);
}
