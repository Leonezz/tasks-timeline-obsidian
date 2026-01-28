import { Task, TaskStatus } from "@tasks-timeline/components";
import {
	MdMarkerToTaskStatus,
	TasksPrioritySymbolToLabel,
} from "./symbols";
import { TaskRegularExpressions } from "./tasksRegex";

/**
 * Converts a task status to the corresponding markdown checkbox marker character.
 * @param status The task status (e.g., "done", "todo", "cancelled", "doing")
 * @returns The marker character (e.g., "x", " ", "-", "/")
 */
const statusToMarkerChar = (status: TaskStatus): string => {
	// Try to find the marker in the MdMarkerToTaskStatus map
	const entry = Object.entries(MdMarkerToTaskStatus).find(
		([_, s]) => s === status
	);
	if (entry) {
		return entry[0];
	}

	// Fallback for known statuses if not found in map
	switch (status) {
		case "done":
			return "x";
		case "cancelled":
			return "-";
		case "doing":
			return "/";
		case "todo":
		default:
			return " ";
	}
};

/**
 * Serializes a Task object back into a markdown string, preserving as much of the original line as possible.
 *
 * @param task The updated Task object.
 * @param originalLine The original markdown line from the file.
 * @returns The new markdown line.
 */
export const taskToMarkdown = (task: Task, originalLine: string): string => {
	let newLine = originalLine;

	// 1. Update Status
	// Find the status check box [ ] or [x] etc.
	const checkboxMatch = newLine.match(TaskRegularExpressions.checkboxRegex);
	if (checkboxMatch) {
		const currentStatusChar = checkboxMatch[1];
		const newStatusChar = statusToMarkerChar(task.status);

		// Only replace if changed
		if (currentStatusChar !== newStatusChar) {
			newLine = newLine.replace(
				TaskRegularExpressions.checkboxRegex,
				`[${newStatusChar}]`
			);
		}
	}

	// 2. Update Title (Description)
	const taskMatch = newLine.match(TaskRegularExpressions.taskRegex);
	if (!taskMatch) {
		return originalLine;
	}

	const indentation = taskMatch[1];
	const listMarker = taskMatch[2];
	const finalStatusChar = statusToMarkerChar(task.status);

	let body = task.title.trim();

	if (task.tags && task.tags.length > 0) {
		let frontmatterTags: string[] = [];
		if (task.extra && task.extra["frontmatterTags"]) {
			try {
				const ft: unknown = task.extra["frontmatterTags"];
				if (Array.isArray(ft)) {
					frontmatterTags = ft as string[];
				} else if (typeof ft === "string") {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					frontmatterTags = JSON.parse(ft);
				}
			} catch (e) {
				console.warn("Failed to parse frontmatterTags", e);
			}
		}

		// Append a tag if:
		// 1. It is NOT in frontmatterTags.
		// 2. OR it IS in frontmatterTags, BUT it matches an inline tag in the original line.
		const tagsToAppend = task.tags
			.map((t) => t.name)
			.filter((tagName) => {
				const isFrontmatter = frontmatterTags.includes(tagName);
				if (!isFrontmatter) return true;
				return originalLine.includes(tagName);
			});

		if (tagsToAppend.length > 0) {
			body += " " + tagsToAppend.join(" ");
		}
	}

	// 3. Append Priority
	if (task.priority !== "medium") {
		const symbol = Object.entries(TasksPrioritySymbolToLabel).find(
			([sym, label]) => label === task.priority && sym !== ""
		);
		if (symbol) {
			body += " " + symbol[0];
		}
	}

	// 4. Append Dates
	if (task.dueAt) body += ` 📅 ${task.dueAt}`;
	if (task.startAt) body += ` 🛫 ${task.startAt}`; // Assuming 🛫 is start
	if (task.extra && task.extra["scheduledAt"])
		body += ` ⏳ ${task.extra["scheduledAt"]}`;
	if (task.createdAt) body += ` ➕ ${task.createdAt}`;
	if (task.completedAt) body += ` ✅ ${task.completedAt}`;

	// 5. Recurrence
	if (task.recurringInterval) {
		body += ` 🔁 ${task.recurringInterval}`;
	}

	// 6. Block Link
	// Check if original line had a block link
	const blockLinkMatch = originalLine.match(
		TaskRegularExpressions.blockLinkRegex
	);
	if (blockLinkMatch) {
		body += blockLinkMatch[0];
	}

	// Construct final line
	return `${indentation}${listMarker} [${finalStatusChar}] ${body}`;
};
