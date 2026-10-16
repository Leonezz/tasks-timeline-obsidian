import type { Pos } from "obsidian";
import type { Task } from "@tasks-timeline/components";

/**
 * A task line as the repository last handed it out. Task ids are line
 * positions, so this is what a caller's id refers to.
 */
export interface TaskSnapshot {
	file: string;
	rawText: string;
	position: string;
}

export function snapshotOf(task: Task): TaskSnapshot | undefined {
	const file = task.extra?.file;
	const rawText = task.extra?.rawText;
	if (!file || !rawText) {
		return undefined;
	}
	return { file, rawText, position: task.extra?.position || "" };
}

/** A list item's text can span continuation lines; the task is the first. */
function firstLine(text: string): string {
	return text.split("\n")[0] ?? "";
}

/** Whether two task lines are the same, ignoring surrounding whitespace. */
export function isSameTaskLine(a: string, b: string): boolean {
	return firstLine(a).trim() === firstLine(b).trim();
}

function lineOfPosition(position: string | undefined): number | undefined {
	if (!position) {
		return undefined;
	}
	try {
		return (JSON.parse(position) as Pos).start.line;
	} catch (e) {
		console.warn("Failed to parse task position", e);
		return undefined;
	}
}

/**
 * Finds a task's line: at its stored position while that line still holds
 * the same text, otherwise the single line elsewhere with that text (lines
 * were added or removed above it). Never falls back to "whatever task sits
 * at the position now", which may be a different task.
 *
 * @returns the line index, or -1 when the line changed or is ambiguous
 */
export function locateTaskLine(
	lines: readonly string[],
	expected: string,
	position: string | undefined,
): number {
	const line = lineOfPosition(position);
	const lineAtPosition = line === undefined ? undefined : lines[line];
	if (
		line !== undefined &&
		lineAtPosition !== undefined &&
		isSameTaskLine(lineAtPosition, expected)
	) {
		return line;
	}

	const matches = lines
		.map((_, index) => index)
		.filter((index) => isSameTaskLine(lines[index] ?? "", expected));
	return matches.length === 1 ? (matches[0] ?? -1) : -1;
}

export function staleTaskError(id: string): Error {
	return new Error(
		`Task ${id} changed since it was read — query tasks again.`,
	);
}

/** The file path of a stored task id (`path:line:col`). */
export function filePathOfTaskId(id: string): string | undefined {
	const match = id.match(/^(.+):\d+:\d+$/);
	return match?.[1];
}
