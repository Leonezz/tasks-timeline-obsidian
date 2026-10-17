import {
	formatTasksMetadata,
	parseTasksFormatItem,
	Task,
	TaskRegularExpressions,
} from "@tasks-timeline/components";
import { DateTime } from "luxon";

/*
 * @tasks-timeline/components v0.8.0 wrote a recurrence rule with a start
 * date as rrule's two-line text, which split the task line:
 *
 *   - [ ] Report 📅 2026-10-16 🔁 DTSTART:20261015T160000Z
 *   RRULE:FREQ=WEEKLY;INTERVAL=1
 *
 * The library can't read or write such a task (it only sees the first
 * line), but the plugin sees both lines, so it joins them: the rule is
 * written as Obsidian Tasks text, with the day DTSTART gave it made
 * explicit ("every week on Friday"), and the "RRULE:" line is removed.
 *
 * v0.8.0 itself read "🔁 DTSTART:20261015T160000Z" as the rule "DTSTART"
 * and left ":20261015T160000Z" in the title, so a task it saved again has
 * the start date in its title and "🔁 DTSTART" after its fields:
 *
 *   - [x] Report  :20261015T160000Z 📅 2026-10-16 ✅ 2026-10-17 🔁 DTSTART
 *   RRULE:FREQ=WEEKLY;INTERVAL=1
 *
 * That is joined the same way, with the start date taken out of the title.
 */

/** The second line of a split rule (and a block id v0.8.0 wrote after it). */
const RULE_LINE = /^[\s>]*RRULE:([A-Za-z0-9=;:,+\-/]+)( \^[a-zA-Z0-9-]+)?\s*$/;
const DTSTART = /^DTSTART(?:;([^:]*))?:(\d{8})(?:T(\d{6})(Z?))?$/;
/** What v0.8.0 left of DTSTART in a title: ";VALUE=DATE:20261016", ":2026…Z". */
const LEFT_START = /(?:^|\s)((?:;[A-Za-z]+=[^\s:;]+)*:\d{8}(?:T\d{6}Z?)?)(?=\s|$)/g;
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const PERIODS: Record<string, string> = {
	DAILY: "days",
	WEEKLY: "weeks",
	MONTHLY: "months",
	YEARLY: "years",
};

export interface SplitRuleRepair {
	/** The rule as read from the task line ("DTSTART:…"). */
	original: string;
	/** The joined rule as Obsidian Tasks text ("every week on Friday"). */
	rule: string;
	/** DTSTART's date, for a task with no date to keep it. */
	startAt?: string;
	/** The task line with the rule as text; it replaces both lines. */
	line: string;
	/** The start date v0.8.0 left in the title, which the line no longer has. */
	titleFragment?: string;
}

class RepairError extends Error {}

/** The day DTSTART starts on: in local time for a UTC time, else as written. */
function startDate(dtstart: string): DateTime {
	const [, params = "", date = "", time, utc] = DTSTART.exec(dtstart) ?? [];
	const start = utc
		? DateTime.fromFormat(`${date}${time}`, "yyyyMMddHHmmss", {
				zone: "utc",
			}).toLocal()
		: DateTime.fromFormat(date, "yyyyMMdd");
	if (!date || (params && !/^(VALUE=DATE|TZID=[^;]+)$/.test(params))) {
		throw new RepairError(`"${dtstart}" is not a start date it can read`);
	}
	if (!start.isValid) {
		throw new RepairError(`"${dtstart}" is not a valid date`);
	}
	return DateTime.fromISO(start.toISODate() ?? "", { zone: "utc" });
}

function ruleParts(rrule: string): Map<string, string> {
	return new Map(
		rrule.split(";").map((part) => {
			const [key = "", ...value] = part.split("=");
			return [key.toUpperCase(), value.join("=")];
		}),
	);
}

/**
 * The rule's parts with the day DTSTART gave it written out, as rrule reads
 * a rule without one: a weekly rule's weekday, a monthly rule's day, a
 * yearly rule's month and day.
 */
function withExplicitDay(
	parts: Map<string, string>,
	start: DateTime,
): Map<string, string> {
	const has = (...keys: string[]) => keys.some((key) => parts.has(key));
	const days = has("BYDAY", "BYMONTHDAY", "BYYEARDAY", "BYWEEKNO");
	const result = new Map(parts);
	const freq = parts.get("FREQ");
	if (freq === "WEEKLY" && !has("BYDAY")) {
		result.set("BYDAY", WEEKDAYS[start.weekday - 1] ?? "");
	} else if (freq === "MONTHLY" && !days) {
		result.set("BYMONTHDAY", String(start.day));
	} else if (freq === "YEARLY" && !days) {
		if (!has("BYMONTH")) result.set("BYMONTH", String(start.month));
		result.set("BYMONTHDAY", String(start.day));
	}
	return result;
}

/** Periods of the rule's frequency from `start` to `date`. */
function periodsBetween(freq: string, start: DateTime, date: DateTime): number {
	switch (freq) {
		case "DAILY":
			return Math.round(date.diff(start, "days").days);
		case "WEEKLY":
			return Math.round(
				date.startOf("week").diff(start.startOf("week"), "weeks").weeks,
			);
		case "MONTHLY":
			return (date.year - start.year) * 12 + date.month - start.month;
		default:
			return date.year - start.year;
	}
}

/**
 * Checks that the text rule gives the dates the split rule gave. Obsidian
 * Tasks counts a rule from the task's date (due, else scheduled, else
 * start), while the split rule counted from DTSTART.
 */
function checkInStep(
	parts: Map<string, string>,
	start: DateTime,
	read: Task,
): void {
	const taskDate = read.dueAt ?? read.extra?.["scheduledAt"] ?? read.startAt;
	if (!taskDate) return;
	const date = DateTime.fromISO(taskDate.slice(0, 10), { zone: "utc" });
	const startText = start.toISODate() ?? "";
	if (date < start) {
		throw new RepairError(
			`the task's date ${taskDate.slice(0, 10)} is before the rule starts on ${startText}`,
		);
	}
	const interval = Number(parts.get("INTERVAL") ?? "1");
	const freq = parts.get("FREQ") ?? "";
	if (interval > 1 && periodsBetween(freq, start, date) % interval !== 0) {
		throw new RepairError(
			`the rule repeats every ${interval} ${PERIODS[freq] ?? ""} from ${startText}, and the task's date ${taskDate.slice(0, 10)} is not in one of them`,
		);
	}
}

/** The joined rule as Obsidian Tasks text. */
function ruleText(rrule: string, dtstart: string, read: Task): string {
	const parts = ruleParts(rrule);
	const freq = parts.get("FREQ") ?? "";
	if (parts.has("COUNT")) {
		throw new RepairError(
			"a rule with COUNT can't be written as Obsidian Tasks text without its start date",
		);
	}
	if (!PERIODS[freq]) {
		throw new RepairError(`a ${freq || "missing"} frequency can't be written as Obsidian Tasks text`);
	}
	const start = startDate(dtstart);
	checkInStep(parts, start, read);
	const joined = [...withExplicitDay(parts, start)]
		.map(([key, value]) => `${key}=${value}`)
		.join(";");
	try {
		return formatTasksMetadata({
			id: "",
			title: "",
			status: "todo",
			priority: "medium",
			tags: [],
			recurringInterval: joined,
		}).replace(/^🔁\s*/u, "");
	} catch (error) {
		throw new RepairError(error instanceof Error ? error.message : String(error));
	}
}

const escapeRegExp = (text: string) =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` without `fragment` and the spaces before it. */
function withoutFragment(text: string, fragment: string): string {
	return text.replace(
		new RegExp(`(?:^|\\s+)${escapeRegExp(fragment)}(?=\\s|$)`),
		"",
	);
}

/** The start date v0.8.0 left in a title, when there is exactly one. */
function leftStartDate(title: string): string | undefined {
	const found = [...title.matchAll(LEFT_START)].map((match) => match[1]);
	return found.length === 1 ? found[0] : undefined;
}

/**
 * Joins a rule v0.8.0 split over `taskLine` ("🔁 DTSTART:…") and the line
 * below it ("RRULE:…").
 *
 * @returns undefined when the lines hold no split rule
 * @throws when they do but the rule can't be written as Obsidian Tasks text
 * with the same dates (COUNT, a task date out of step with the rule), with
 * the manual fix
 */
export function repairSplitRule(
	taskLine: string,
	nextLine: string | undefined,
): SplitRuleRepair | undefined {
	const body = TaskRegularExpressions.taskRegex.exec(taskLine)?.[4];
	const ruleLine = nextLine === undefined ? null : RULE_LINE.exec(nextLine);
	if (body === undefined || !ruleLine?.[1]) {
		return undefined;
	}
	const read = parseTasksFormatItem({
		id: "",
		title: body,
		status: "todo",
		priority: "medium",
		tags: [],
	});
	const original = read.recurringInterval;
	if (!original?.startsWith("DTSTART")) {
		return undefined;
	}
	// A task v0.8.0 saved again: its start date is in the title.
	const left = original === "DTSTART" ? leftStartDate(read.title) : undefined;
	try {
		if (original === "DTSTART" && !left) {
			throw new RepairError(
				'"🔁 DTSTART" has lost its start date, so the day the rule repeats on is unknown',
			);
		}
		const dtstart = left ? `${original}${left}` : original;
		const rule = ruleText(ruleLine[1], dtstart, read);
		const hasDate = !!(read.dueAt || read.startAt || read.extra?.["scheduledAt"]);
		const startAt = hasDate ? undefined : startDate(dtstart).toISODate() ?? undefined;
		const written = startAt ? `${rule} 🛫 ${startAt}` : rule;
		const blockId = ruleLine[2] ?? "";
		if (blockId && TaskRegularExpressions.blockLinkRegex.test(taskLine)) {
			throw new RepairError("both lines end with a block id");
		}
		const at = taskLine.indexOf(original, taskLine.indexOf("🔁"));
		const before = taskLine.slice(0, at);
		const line =
			(left ? withoutFragment(before, left) : before) +
			written +
			taskLine.slice(at + original.length).trimEnd() +
			blockId;
		return {
			original,
			rule,
			line,
			...(startAt ? { startAt } : {}),
			...(left ? { titleFragment: left } : {}),
		};
	} catch (error) {
		if (!(error instanceof RepairError)) throw error;
		const removeLeft = left ? `remove "${left}" from the title, ` : "";
		throw new Error(
			`Cannot repair the recurrence rule v0.8.0 split over two lines ("🔁 ${original}" and "RRULE:${ruleLine[1]}"): ${error.message}. Edit the note: delete the "RRULE:" line below the task, ${removeLeft}and replace "🔁 ${original}" with the rule as Obsidian Tasks text, such as "🔁 every week".`,
		);
	}
}

/**
 * The task to write onto a repaired line: with the joined rule when it
 * still has the rule as read from the split line (a read that could not see
 * the rule's second line), else as it is; and without the start date
 * v0.8.0 left in its title.
 */
export function withRepairedRule(
	task: Task,
	repair: SplitRuleRepair | undefined,
): Task {
	if (!repair) {
		return task;
	}
	const titled = repair.titleFragment
		? { ...task, title: withoutFragment(task.title, repair.titleFragment).trim() }
		: task;
	if (task.recurringInterval !== repair.original) {
		return titled;
	}
	return {
		...titled,
		isRecurring: true,
		recurringInterval: repair.rule,
		startAt: task.startAt ?? repair.startAt,
	};
}

/**
 * A task read from the vault with its split rule joined, so the timeline,
 * the agent and complete_task see the rule it stands for. The note changes
 * only when the task is saved. A rule that can't be joined is left as read:
 * saving the task then fails with the manual fix.
 */
export function withJoinedSplitRule(task: Task): Task {
	const [line = "", next] = (task.extra?.rawText ?? "").split("\n");
	try {
		return withRepairedRule(task, repairSplitRule(line, next));
	} catch (error) {
		console.warn(error);
		return task;
	}
}
