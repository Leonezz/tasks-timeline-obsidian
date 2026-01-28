import { Priority, Task } from "@tasks-timeline/components";
import { getFileTitle } from "./link";
import { DateTime } from "luxon";
import {
	MdMarkerToTaskStatus,
	TasksPrioritySymbolToLabel,
} from "./symbols";
import { TaskRegularExpressions } from "./tasksRegex";

const parseDate = (str: string, exp: RegExp): DateTime | null => {
	const dateMatch = str.match(exp);
	if (dateMatch !== null && dateMatch[1]) {
		const date = DateTime.fromFormat(
			dateMatch[1],
			TaskRegularExpressions.dateFormat
		);
		if (date.isValid) {
			return date;
		}
		return null;
	}
	return null;
};

const parsePriority = (str: string, exp: RegExp): Priority | null => {
	const priorityMatch = str.match(TaskRegularExpressions.priorityRegex);
	if (priorityMatch !== null && priorityMatch[1]) {
		return (
			TasksPrioritySymbolToLabel[
				priorityMatch[1]
			] || "medium"
		);
	}
	return null;
};

const parseStringPattern = (str: string, exp: RegExp): string | null => {
	const strMatch = str.match(exp);
	if (strMatch !== null && strMatch[1]) {
		// Save the recurrence rule, but *do not parse it yet*.
		// Creating the Recurrence object requires a reference date (e.g. a due date),
		// and it might appear in the next (earlier in the line) tokens to parse
		return strMatch[1].trim();
	}
	return null;
};

const parseTrailingTag = (str: string, exp: RegExp): string | null => {
	const strMatch = str.match(exp);
	if (strMatch !== null && strMatch[0]) {
		return strMatch[0].trim();
	}
	return null;
};

type ParseFieldType = {
	priority: Priority;
	date: DateTime<true>;
	trailingTag: string;
	pattern: string;
};

// returns: Parsed, description, matched
const parseAndReplace = <Key extends keyof ParseFieldType>(
	key: Key,
	str: string,
	exp: RegExp,
	original: ParseFieldType[Key] | undefined
): [ParseFieldType[Key] | undefined, string, boolean] => {
	switch (key) {
		case "date": {
			const newDate = parseDate(str, exp);
			if (newDate) {
				return [
					newDate as unknown as ParseFieldType[Key],
					str.replace(exp, "").trim(),
					true,
				];
			}
			return [original, str, false];
		}
		case "priority": {
			const newPriority = parsePriority(str, exp);
			if (newPriority) {
				return [
					newPriority as unknown as ParseFieldType[Key],
					str.replace(exp, "").trim(),
					true,
				];
			}
			return [original, str, false];
		}
		case "trailingTag": {
			const newTag = parseTrailingTag(str, exp);
			if (newTag) {
				const result =
					original && (original as string).length > 0
						? [newTag, original as string].join(" ")
						: newTag;
				return [
					result as unknown as ParseFieldType[Key],
					str.replace(exp, "").trim(),
					true,
				];
			}
			return [original, str, false];
		}
		case "pattern": {
			const newPattern = parseStringPattern(str, exp);
			if (newPattern) {
				return [
					newPattern as unknown as ParseFieldType[Key],
					str.replace(exp, "").trim(),
					true,
				];
			}
			return [original, str, false];
		}
	}
};

/**
 * This function is taken from TasksPlugin, it is originally named fromLine.
 * We use this function to extract information that matches the TasksPlugin format.
 * @param item
 * @returns
 */
export const parseTasksFormatItem = (item: Task): Task => {
	// Check the line to see if it is a markdown task.
	let description = item.title;
	// Keep matching and removing special strings from the end of the
	// description in any order. The loop should only run once if the
	// strings are in the expected order after the description.
	let matched: boolean;
	let priority: Priority = "medium";
	let startDate: DateTime | undefined = undefined;
	let scheduledDate: DateTime | undefined = undefined;
	//const scheduledDateIsInferred = false;
	let dueDate: DateTime | undefined = undefined;
	let doneDate: DateTime | undefined = undefined;
	let createDate: DateTime | undefined = undefined;
	let recurrenceRule: string | undefined = undefined;
	//const recurrence: string | null = null;
	// Tags that are removed from the end while parsing, but we want to add them back for being part of the description.
	// In the original task description they are possibly mixed with other components
	// (e.g. #tag1 <due date> #tag2), they do not have to all trail all task components,
	// but eventually we want to paste them back to the task description at the end
	let trailingTags = "";
	// Add a "max runs" failsafe to never end in an endless loop:
	const maxRuns = 20;
	let runs = 0;
	do {
		matched = false;

		const [priorityParsed, afterPriority, priorityMatched]: [
			Priority | undefined,
			string,
			boolean
		] = parseAndReplace(
			"priority",
			description,
			TaskRegularExpressions.priorityRegex,
			priority
		);
		if (priorityParsed && priorityMatched) {
			priority = priorityParsed;
			description = afterPriority;
			matched = priorityMatched;
		}

		const [createDataParsed, afterCreateDate, createDateMatched]: [
			DateTime | undefined,
			string,
			boolean
		] = parseAndReplace(
			"date",
			description,
			TaskRegularExpressions.createDateRegex,
			createDate
		);
		if (createDataParsed && createDateMatched) {
			createDate = createDataParsed;
			description = afterCreateDate;
			matched = createDateMatched;
		}
		const [doneDateParsed, afterDoneDate, doneDateMatched]: [
			DateTime | undefined,
			string,
			boolean
		] = parseAndReplace(
			"date",
			description,
			TaskRegularExpressions.doneDateRegex,
			doneDate
		);
		if (doneDateMatched && doneDateParsed) {
			doneDate = doneDateParsed;
			matched = doneDateMatched;
			description = afterDoneDate;
		}

		const [dueDataParsed, afterDueDate, dueDateMatched]: [
			DateTime | undefined,
			string,
			boolean
		] = parseAndReplace(
			"date",
			description,
			TaskRegularExpressions.dueDateRegex,
			dueDate
		);
		if (dueDataParsed && dueDateMatched) {
			dueDate = dueDataParsed;
			description = afterDueDate;
			matched = dueDateMatched;
		}

		const [scheduledDataParsed, afterScheduledDate, scheduledDateMatched]: [
			DateTime | undefined,
			string,
			boolean
		] = parseAndReplace(
			"date",
			description,
			TaskRegularExpressions.scheduledDateRegex,
			scheduledDate
		);

		if (scheduledDataParsed && scheduledDateMatched) {
			scheduledDate = scheduledDataParsed;
			description = afterScheduledDate;
			matched = scheduledDateMatched;
		}
		const [startDateParsed, afterStartDate, startDateMatched]: [
			DateTime | undefined,
			string,
			boolean
		] = parseAndReplace(
			"date",
			description,
			TaskRegularExpressions.startDateRegex,
			startDate
		);
		if (startDateParsed && startDateMatched) {
			startDate = startDateParsed;
			description = afterStartDate;
			matched = startDateMatched;
		}

		// Match tags from the end to allow users to mix the various task components with
		// tags. These tags will be added back to the description below
		const [newTag, afterNewTag, newTagMatched]: [
			string | undefined,
			string,
			boolean
		] = parseAndReplace(
			"trailingTag",
			description,
			TaskRegularExpressions.hashTagsFromEnd,
			undefined
		);
		if (newTag && newTagMatched) {
			matched = true;
			description = afterNewTag;
			trailingTags = newTag;
		}

		const [recurrenceParsed, afterRecurrence, recurrenceMatched]: [
			string | undefined,
			string,
			boolean
		] = parseAndReplace(
			"pattern",
			description,
			TaskRegularExpressions.recurrenceRegex,
			recurrenceRule
		);
		if (recurrenceMatched && recurrenceParsed) {
			recurrenceRule = recurrenceParsed;
			matched = recurrenceMatched;
			description = afterRecurrence;
		}

		runs++;
	} while (matched && runs <= maxRuns);

	// Add back any trailing tags to the description. We removed them so we can parse the rest of the
	// components but now we want them back.
	// The goal is for a task of them form 'Do something #tag1 (due) tomorrow #tag2 (start) today'
	// to actually have the description 'Do something #tag1 #tag2'
	if (trailingTags.length > 0) description += " " + trailingTags;

	const isTasksTask = [
		startDate,
		scheduledDate,
		dueDate,
		doneDate,
		createDate,
	].some((d) => !!d);

	const result = {
		...item,
		title: description,
		priority: priority,
		recurringInterval: recurrenceRule,
		dueAt: dueDate?.toISODate() || undefined,
		createdAt: createDate?.toISODate() || undefined,
		startAt: startDate?.toISODate() || undefined,
		completedAt: doneDate?.toISODate() || undefined,
	} satisfies Task;

	if (!result.extra) {
		result.extra = {};
	}
	if (scheduledDate) {
		result.extra["scheduledAt"] = scheduledDate.toISODate() || "";
	}
	result.extra["isTasksTask"] = isTasksTask ? "true" : "false";
	return result;
};

export const parseDataViewFormatItem = (item: Task): Task => {
	let itemText = item.title;
	const inlineFields = itemText.match(TaskRegularExpressions.keyValueRegex);
	if (!inlineFields) {
		return item;
	}
	for (const inlineField of inlineFields) {
		// this is necessary since every time RegEx.exec,
		// the lastIndex changed like an internal state.
		TaskRegularExpressions.keyValueRegex.lastIndex = 0;
		const tkv = TaskRegularExpressions.keyValueRegex.exec(inlineField)!;
		const [text, key, value] = [tkv[0], tkv[1], tkv[2]];
		console.debug(
			`DEBUG: text: [${text}], key: [${key}], value: [${value}]`
		);
		itemText = itemText.replace(text, "");
		if (!key || !value) continue;
		const normalizedKey = key?.trim().toLowerCase();
		console.debug(
			`DEBUG: [${normalizedKey}], length: [${normalizedKey.length}]`
		);
		const normalizedValue = value.trim();
		const fieldDate = DateTime.fromFormat(
			normalizedValue,
			TaskRegularExpressions.dateFormat
		);
		if (!fieldDate.isValid) {
			console.warn(
				"Parse date for item failed, value: ",
				fieldDate,
				", item: ",
				item
			);
			continue;
		}
		if (!item.extra) {
			item.extra = {};
		}
		switch (normalizedKey) {
			case "due":
				item.dueAt = fieldDate.toISODate();
				break;
			case "scheduled":
				item.extra["scheduledAt"] = fieldDate.toISODate();
				break;
			case "complete":
			case "completion":
			case "done":
				item.completedAt = fieldDate.toISODate();
				break;
			case "created":
				item.createdAt = fieldDate.toISODate();
				break;
			case "start":
				item.startAt = fieldDate.toISODate();
				break;
			default:
				item.extra[normalizedKey] = value;
				break;
		}
	}
	item.title = itemText;
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

export const tagsParser = (item: Task): Task => {
	const match = item.title.match(TaskRegularExpressions.hashTags);
	if (!match) {
		return item;
	}
	for (const m of match) {
		item.title = item.title.replace(m, "").trim();
		const tag = m.trim();
		item.tags.push({
			id: tag,
			name: tag,
		});
	}
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
