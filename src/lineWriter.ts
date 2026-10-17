import {
	parseTasksFormatItem,
	Task,
	TaskRegularExpressions,
	taskToMarkdown,
} from "@tasks-timeline/components";
import {
	InlineDateField,
	inlineDateFieldOf,
	InlineField,
	inlineFieldDate,
	inlineFieldsIn,
	withoutInlineFields,
	withoutTags,
} from "./parsers";

/*
 * Writing tasks back onto their Obsidian lines.
 *
 * The timeline shows titles without the Dataview inline fields the plugin
 * reads ([[key:: value]]), and a date such a field holds becomes the task's
 * date. taskToMarkdown only knows the title: it rewrites a line's text when
 * the title's words change, and writes every date as a Tasks field. So
 * before writing, the text taken out of the title is put back, and a date a
 * Dataview field holds is written in that field instead of as a 📅 field.
 * Everything else on the line stays byte for byte.
 */

const words = (text: string): string =>
	text.split(/\s+/).filter(Boolean).join(" ");

/** Stands for an inline field while tags are taken out around it. */
const FIELD_MARK = / ?(\d+) ?/g;

/**
 * The line's title text without the tags the plugin moved to `task.tags`
 * (tags inside a Dataview field are not tags), keeping the inline fields.
 */
function lineTitleOf(description: string): string {
	const fields: string[] = [];
	const marked = description.replace(
		TaskRegularExpressions.keyValueRegex,
		(field) => ` ${fields.push(field) - 1} `,
	);
	return withoutTags(marked).replace(
		FIELD_MARK,
		(_mark: string, index: string) => fields[Number(index)] ?? "",
	);
}

function dateValue(task: Task, field: InlineDateField): string | undefined {
	const value =
		field === "scheduledAt" ? task.extra?.["scheduledAt"] : task[field];
	return value ? value.slice(0, 10) : undefined;
}

function withDateValue(
	task: Task,
	field: InlineDateField,
	value: string | undefined,
): Task {
	if (field !== "scheduledAt") {
		return { ...task, [field]: value };
	}
	const extra = Object.fromEntries(
		Object.entries(task.extra ?? {}).filter(([key]) => key !== "scheduledAt"),
	);
	return { ...task, extra: value ? { ...extra, scheduledAt: value } : extra };
}

interface FieldEdit {
	text: string;
	/** The new field text, or "" to remove the field. */
	replacement: string;
}

/**
 * The Dataview fields that hold a task date (the last one of each date, as
 * the parser reads them), and how to write the task's dates into them.
 */
function dateFieldEdits(
	task: Task,
	fields: readonly InlineField[],
): { edits: FieldEdit[]; dates: InlineDateField[] } {
	const effective = new Map<InlineDateField, InlineField>();
	fields.forEach((field) => {
		const date = inlineDateFieldOf(field);
		if (date && inlineFieldDate(field)) effective.set(date, field);
	});
	const edits = [...effective].flatMap(([date, field]): FieldEdit[] => {
		const value = dateValue(task, date);
		if (value === inlineFieldDate(field)) return [];
		return [
			{
				text: field.text,
				replacement: value ? field.text.replace(field.value.trim(), value) : "",
			},
		];
	});
	return { edits, dates: [...effective.keys()] };
}

/** `text` with the field edited, or removed with the space before it. */
function applyEdit(text: string, edit: FieldEdit): string {
	const at = text.indexOf(edit.text);
	if (at === -1 || text.includes(edit.text, at + 1)) {
		throw new Error(
			`Cannot change the Dataview field ${edit.text}: it is ${at === -1 ? "no longer" : "more than once"} on the task line. Edit the line in the note.`,
		);
	}
	const start =
		!edit.replacement && at > 0 && /\s/.test(text[at - 1] ?? "") ? at - 1 : at;
	return text.slice(0, start) + edit.replacement + text.slice(at + edit.text.length);
}

/**
 * Writes a task onto its line (`text` may go on with description lines,
 * which are kept). Like taskToMarkdown, but keeps the Dataview fields the
 * plugin took out of the title, and writes a date a Dataview field holds in
 * that field: changed in place, or removed with the date. When the title was
 * renamed, its Dataview fields follow the new title.
 *
 * @throws as taskToMarkdown does, or when a Dataview field to change is no
 * longer on the line or is on it twice
 */
export function writeTaskOnLine(task: Task, text: string): string {
	const [line = "", ...below] = text.split("\n");
	const body = TaskRegularExpressions.taskRegex.exec(line)?.[4];
	if (body === undefined) {
		return taskToMarkdown(task, text);
	}
	// The line's own Tasks fields, without what the plugin read into them.
	const read = parseTasksFormatItem({ ...task, title: body, extra: {} });
	const lineTitle = lineTitleOf(read.title);
	const titleFields = inlineFieldsIn(lineTitle);
	const title =
		words(task.title) === words(withoutInlineFields(lineTitle))
			? lineTitle
			: [task.title.trim(), ...titleFields.map((field) => field.text)].join(
					" ",
				);
	const { edits, dates } = dateFieldEdits(task, [
		...titleFields,
		...inlineFieldsIn(read.extra?.["lineNotes"] ?? ""),
	]);
	const lineTask = dates.reduce(
		(written, date) => withDateValue(written, date, dateValue(read, date)),
		{ ...task, title },
	);
	const written = edits.reduce(applyEdit, taskToMarkdown(lineTask, line));
	return [written, ...below].join("\n");
}

/**
 * A task for a new line that carries notes from another line (the next
 * occurrence of a recurring task): dates the notes' Dataview fields hold are
 * written there, as on the line the notes come from.
 */
export function withNotesForNewLine(task: Task): Task {
	const notes = task.extra?.["lineNotes"];
	if (!notes) {
		return task;
	}
	const { edits, dates } = dateFieldEdits(task, inlineFieldsIn(notes));
	return dates.reduce(
		(written, date) => withDateValue(written, date, undefined),
		{ ...task, extra: { ...task.extra, lineNotes: edits.reduce(applyEdit, notes) } },
	);
}
