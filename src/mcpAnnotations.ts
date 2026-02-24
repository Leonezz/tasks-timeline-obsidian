import type { Task } from "@tasks-timeline/components";

/**
 * MCP tool annotation types following the MCP specification.
 */
export interface ToolAnnotations {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
}

const READ_ONLY: ToolAnnotations = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: false,
};

const WRITE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
	openWorldHint: false,
};

const DESTRUCTIVE: ToolAnnotations = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: false,
};

/**
 * Per-tool annotation map. Keys must match the tool names from
 * the component library's `createCapabilities()`.
 */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
	// Read-only tools
	query_tasks: READ_ONLY,
	get_task_stats: READ_ONLY,
	get_today_plan: READ_ONLY,
	list_sessions: READ_ONLY,

	// Write tools
	create_task: WRITE,
	update_task: WRITE,
	batch_update_tasks: WRITE,
	complete_task: WRITE,

	// Destructive tools
	delete_task: DESTRUCTIVE,
	cancel_task: DESTRUCTIVE,
};

/**
 * Content item returned as an additional annotation in tool responses.
 */
interface AnnotationContent {
	type: "text";
	text: string;
}

/**
 * Generates contextual annotations for tool results.
 * Returns extra content items to append to the response.
 */
export function generateResultAnnotations(
	_toolName: string,
	result: unknown,
): AnnotationContent[] {
	const annotations: AnnotationContent[] = [];

	if (!Array.isArray(result)) {
		return annotations;
	}

	const tasks = result as Task[];

	// Large result set warning
	if (tasks.length > 100) {
		annotations.push({
			type: "text",
			text: `[Note: Large result set with ${tasks.length} tasks. Consider using filters to narrow results.]`,
		});
	}

	// Count overdue tasks
	const now = Date.now();
	const overdueTasks = tasks.filter((t) => {
		if (t.status === "done" || t.status === "cancelled") return false;
		const dueDate = t.dueAt;
		if (!dueDate) return false;
		return new Date(dueDate).getTime() < now;
	});
	if (overdueTasks.length > 0) {
		annotations.push({
			type: "text",
			text: `[Warning: ${overdueTasks.length} overdue task(s) found in results.]`,
		});
	}

	// Count high-priority tasks
	const highPriority = tasks.filter(
		(t) =>
			t.priority === "high" &&
			t.status !== "done" &&
			t.status !== "cancelled",
	);
	if (highPriority.length > 0) {
		annotations.push({
			type: "text",
			text: `[Info: ${highPriority.length} high-priority task(s) in results.]`,
		});
	}

	return annotations;
}
