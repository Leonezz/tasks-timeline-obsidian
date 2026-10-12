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
