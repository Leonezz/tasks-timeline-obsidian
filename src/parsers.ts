import {
	MdMarkerToTaskStatus,
	Task,
	TaskRegularExpressions,
} from "@tasks-timeline/components";
import { getFileTitle } from "./link";
import { DateTime } from "luxon";

// parseTasksFormatItem (Tasks plugin emoji format) now lives in
// @tasks-timeline/components (src/tasks-format, released after v0.4.35);
// only Obsidian-specific parsers remain here.

/** A Dataview inline field, `[[key:: value]]`, as written in a task line. */
export interface InlineField {
	/** The field as written, brackets included. */
	text: string;
	key: string;
	value: string;
}

/** The Dataview inline fields in `text`, in order. */
export function inlineFieldsIn(text: string): InlineField[] {
	return [...text.matchAll(TaskRegularExpressions.keyValueRegex)].flatMap(
		([fieldText, key, value]) =>
			fieldText !== undefined && key && value
				? [{ text: fieldText, key, value }]
				: [],
	);
}

/** `text` without its Dataview inline fields, as the timeline shows titles. */
export function withoutInlineFields(text: string): string {
	return text.replace(TaskRegularExpressions.keyValueRegex, "");
}

/** The task date fields Dataview keys stand for. */
export type InlineDateField =
	| "dueAt"
	| "scheduledAt"
	| "completedAt"
	| "createdAt"
	| "startAt";

const INLINE_DATE_FIELDS: Record<string, InlineDateField> = {
	due: "dueAt",
	scheduled: "scheduledAt",
	complete: "completedAt",
	completion: "completedAt",
	done: "completedAt",
	created: "createdAt",
	start: "startAt",
};

/** The date an inline field holds (YYYY-MM-DD), or undefined. */
export function inlineFieldDate(field: InlineField): string | undefined {
	const date = DateTime.fromFormat(
		field.value.trim(),
		TaskRegularExpressions.dateFormat,
	);
	return date.isValid ? (date.toISODate() ?? undefined) : undefined;
}

/** The task date field an inline field's key stands for, if any. */
export function inlineDateFieldOf(
	field: InlineField,
): InlineDateField | undefined {
	return INLINE_DATE_FIELDS[field.key.trim().toLowerCase()];
}

function applyInlineField(item: Task, field: InlineField): void {
	const date = inlineFieldDate(field);
	if (!date) {
		console.warn(
			"Parse date for item failed, value: ",
			field.value,
			", item: ",
			item,
		);
		return;
	}
	if (!item.extra) {
		item.extra = {};
	}
	const dateField = inlineDateFieldOf(field);
	if (dateField === "scheduledAt") {
		item.extra["scheduledAt"] = date;
	} else if (dateField) {
		item[dateField] = date;
	} else {
		item.extra[field.key.trim().toLowerCase()] = field.value;
	}
}

/**
 * Reads Dataview inline fields (`[[key:: value]]`) in the title and in the
 * notes after the Tasks fields (`extra.lineNotes`). Fields in the title are
 * taken out of it; the line keeps them (see lineWriter.ts). A field later on
 * the line overrides an earlier one, and the Tasks field for the same date.
 */
export const parseDataViewFormatItem = (item: Task): Task => {
	const fields = [
		...inlineFieldsIn(item.title),
		...inlineFieldsIn(item.extra?.lineNotes ?? ""),
	];
	fields.forEach((field) => applyInlineField(item, field));
	item.title = withoutInlineFields(item.title).trim();
	return item;
};

export const dailyNoteTaskParser = (
	dailyNoteFormat: string = TaskRegularExpressions.dateFormat
) => {
	return (item: Task): Task => {
		const taskFile: string = getFileTitle(item.category || "");
		const dailyNoteDate = DateTime.fromFormat(taskFile, dailyNoteFormat);
		if (!dailyNoteDate.isValid) {
			return item;
		}
		if (!item.extra) {
			item.extra = {};
		}
		item.extra["isDailyNote"] = "true";
		const date = dailyNoteDate.toISODate() || "";
		item.startAt = date;
		item.createdAt = date;
		item.dueAt = date;
		return item;
	};
};

export const remainderParser = (item: Task): Task => {
	const match = item.title.match(TaskRegularExpressions.remainderRegex);
	if (!match) {
		return item;
	}
	item.title = item.title.replace(match[0], "").trim();
	return item;
};

/** The `#tags` in `text`, each with the space before it. */
function tagsIn(text: string): string[] {
	return text.match(TaskRegularExpressions.hashTags) ?? [];
}

/** `text` without its `#tags`, as tagsParser takes them out of titles. */
export function withoutTags(text: string): string {
	return tagsIn(text).reduce((rest, tag) => rest.replace(tag, "").trim(), text);
}

export const tagsParser = (item: Task): Task => {
	const tags = tagsIn(item.title);
	item.title = withoutTags(item.title);
	tags.forEach((m) => {
		const tag = m.trim();
		item.tags.push({
			id: tag,
			name: tag,
		});
	});
	return item;
};

export const markerBasedStatusParser = (item: Task) => {
	if (!item.extra || !item.extra["marker"]) {
		return item;
	}
	const status = MdMarkerToTaskStatus[item.extra["marker"]];
	if (!status) {
		return item;
	}
	item.status = status;
	return item;
};
