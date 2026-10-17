import type { Pos } from "obsidian";
import type { Task } from "@tasks-timeline/components";

/**
 * A task line as the repository last handed it out. Task ids are line
 * positions, so this is what a caller's id refers to.
 */
export interface TaskSnapshot {
	file: string;
	/** The line as this repository knows it, including its own writes. */
	rawText: string;
	/** The line as last read from the vault, before this repository's writes. */
	loadedText: string;
	position: string;
}

export function snapshotOf(task: Task): TaskSnapshot | undefined {
	const file = task.extra?.file;
	const rawText = task.extra?.rawText;
	if (!file || !rawText) {
		return undefined;
	}
	return {
		file,
		rawText,
		loadedText: rawText,
		position: task.extra?.position || "",
	};
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

/**
 * A short version of a task's line (FNV-1a over its content), carried in
 * the ids handed to MCP clients so an id names the line it was issued for.
 * Formatting the comparison ignores (quote prefix, indentation, trailing
 * spaces) does not change it.
 */
export function taskLineVersion(rawText: string): string {
	const [line = ""] = rawText.split("\n");
	let hash = 0x811c9dc5;
	for (const char of lineContent(line)) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36);
}

/** Whether two tasks have the same task line (descriptions aside). */
export function isSameTaskLine(a: string, b: string): boolean {
	const [lineA = ""] = a.split("\n");
	const [lineB = ""] = b.split("\n");
	return lineContent(lineA) === lineContent(lineB);
}

function parsePosition(position: string | undefined): Pos | undefined {
	if (!position) {
		return undefined;
	}
	try {
		return JSON.parse(position) as Pos;
	} catch (e) {
		console.warn("Failed to parse task position", e);
		return undefined;
	}
}

/**
 * A rewritten task line in the form task text is stored and read back:
 * from where Obsidian's list item starts, after any `> ` or indentation.
 */
export function storedLineText(
	line: string,
	position: string | undefined,
): string {
	return line.slice(parsePosition(position)?.start.col ?? 0);
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
	const line = parsePosition(position)?.start.line;
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

const indentWidth = (whitespace: string): number =>
	[...whitespace].reduce((width, c) => width + (c === "\t" ? 4 : 1), 0);

/** A line's quote depth, indentation width and text after both. */
function lineShape(line: string): {
	quoteDepth: number;
	indent: number;
	text: string;
} {
	const quote = line.match(/^(?:[ \t]*>[ ]?)*/)?.[0] ?? "";
	const afterQuote = line.slice(quote.length);
	const indentation = afterQuote.match(/^[ \t]*/)?.[0] ?? "";
	return {
		quoteDepth: (quote.match(/>/g) ?? []).length,
		indent: indentWidth(indentation),
		text: afterQuote.slice(indentation.length),
	};
}

/**
 * Whether list items are nested under the task on `taskLine`, whose own
 * lines end before `after`. Removing the task would leave them indented
 * under nothing, which Obsidian reads as a code block or paragraph text, so
 * they would drop off the timeline.
 */
export function hasNestedItems(
	lines: readonly string[],
	taskLine: number,
	after: number,
): boolean {
	const task = lineShape(lines[taskLine] ?? "");
	const next = lines
		.slice(after)
		.map(lineShape)
		.find((shape) => shape.text.trim() !== "");
	return (
		next !== undefined &&
		next.quoteDepth === task.quoteDepth &&
		next.indent > task.indent &&
		LIST_ITEM.test(next.text)
	);
}

/** The task an id names changed since the id was handed out. */
export class StaleTaskError extends Error {
	readonly taskId: string;

	constructor(taskId: string) {
		super(`Task ${taskId} changed since it was read — query tasks again.`);
		this.name = "StaleTaskError";
		this.taskId = taskId;
	}
}

/** The file path of a stored task id (`path:line:col`). */
export function filePathOfTaskId(id: string): string | undefined {
	const match = id.match(/^(.+):\d+:\d+$/);
	return match?.[1];
}
