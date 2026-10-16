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

const LIST_ITEM = /^([-*+]|\d+[.)])\s/;

/**
 * A line's text without its quote or callout prefix, indentation and
 * trailing spaces. A task's stored text starts after any `> ` prefix (that
 * is where Obsidian's list item starts), while file lines include it.
 */
function lineContent(line: string): string {
	return line.replace(/^[\s>]*/, "").trimEnd();
}

/**
 * The lines a task occupies: its own line, then the description lines that
 * Obsidian counts as part of the list item. Stops at a nested list item,
 * which is a task of its own.
 */
function blockLines(rawText: string): string[] {
	const [first = "", ...rest] = rawText.split("\n");
	const nested = rest.findIndex((line) => LIST_ITEM.test(lineContent(line)));
	return [first, ...(nested === -1 ? rest : rest.slice(0, nested))];
}

/** Whether two tasks have the same task line (descriptions aside). */
export function isSameTaskLine(a: string, b: string): boolean {
	const [lineA = ""] = a.split("\n");
	const [lineB = ""] = b.split("\n");
	return lineContent(lineA) === lineContent(lineB);
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

function matchesAt(
	lines: readonly string[],
	start: number,
	expectedLines: readonly string[],
): boolean {
	return expectedLines.every((expected, offset) => {
		const line = lines[start + offset];
		return line !== undefined && lineContent(line) === lineContent(expected);
	});
}

/**
 * Finds where `expectedLines` sit: at the stored position while those lines
 * still hold the same text, otherwise the single place elsewhere that does
 * (lines were added or removed above). Never falls back to "whatever task
 * sits at the position now", which may be a different task.
 *
 * @returns the first line's index, or -1 when changed or ambiguous
 */
function locate(
	lines: readonly string[],
	expectedLines: readonly string[],
	position: string | undefined,
): number {
	const line = lineOfPosition(position);
	if (line !== undefined && matchesAt(lines, line, expectedLines)) {
		return line;
	}
	const matches = lines
		.map((_, index) => index)
		.filter((index) => matchesAt(lines, index, expectedLines));
	return matches.length === 1 ? (matches[0] ?? -1) : -1;
}

/**
 * Finds a task's own line, for rewriting it. Its description lines may have
 * changed; only the task line is rewritten.
 *
 * @returns the line index, or -1 when the line changed or is ambiguous
 */
export function locateTaskLine(
	lines: readonly string[],
	expected: string,
	position: string | undefined,
): number {
	return locate(lines, blockLines(expected).slice(0, 1), position);
}

/**
 * Finds all lines of a task (its line and description lines), for removing
 * them. Every one must still hold the text it had when read.
 *
 * @returns the first line and line count, or undefined when changed
 */
export function locateTaskBlock(
	lines: readonly string[],
	expected: string,
	position: string | undefined,
): { start: number; count: number } | undefined {
	const expectedLines = blockLines(expected);
	const start = locate(lines, expectedLines, position);
	return start === -1 ? undefined : { start, count: expectedLines.length };
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
