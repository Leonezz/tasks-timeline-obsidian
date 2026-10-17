import {
	formatTasksMetadata,
	parseTasksFormatItem,
	Task,
	TaskRegularExpressions,
	TasksPrioritySymbolToLabel,
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
 *
 * v0.8.0 wrote its fields after the title, so the fields it wrote before
 * the start date stay in the title, and its parser, like Obsidian Tasks's,
 * stops there: "- [ ] Report ⏫  :20261015T160000Z 📅 …" reads as medium
 * priority. Joined, they read as fields again. When the line also has the
 * same field after the start date (the user set the priority again in
 * v0.8.0: "Report ⏫  :20261015T160000Z 🔽 📅 …"), v0.8.0 and Obsidian
 * Tasks read the one after it, so the joined line keeps that one and drops
 * the one left in the title.
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
	/**
	 * The fields left in the title right before {@link titleFragment} that
	 * the line also has after it, as written, which the line no longer has:
	 * v0.8.0 and Obsidian Tasks read the ones after it.
	 */
	strandedFields?: string[];
}

class RepairError extends Error {}

/** A split rule that can't be joined, with the manual fix. */
class UnrepairableRuleError extends Error {}

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

/**
 * The start date v0.8.0 left in a title, when there is exactly one. A field
 * before it (a date typed ahead of the rule) ends the title, so it can also
 * be in the text after that field.
 */
function leftStartDate(read: Task): string | undefined {
	const text = `${read.title} ${read.extra?.["lineNotes"] ?? ""}`;
	const found = [...text.matchAll(LEFT_START)].map((match) => match[1]);
	return found.length === 1 ? found[0] : undefined;
}

/** A task with no fields, titled `title`, for reading fields out of text. */
const untitledTask = (title: string): Task => ({
	id: "",
	title,
	status: "todo",
	priority: "medium",
	tags: [],
});

/** The text after a task line's checkbox. */
const bodyOf = (taskLine: string): string =>
	TaskRegularExpressions.taskRegex.exec(taskLine)?.[4] ?? "";

/** A task field, by where a Task holds it (scheduledAt is in `extra`). */
type FieldKey =
	| "priority"
	| "dueAt"
	| "startAt"
	| "scheduledAt"
	| "createdAt"
	| "completedAt"
	| "cancelledAt"
	| "recurringInterval"
	| "onCompletion"
	| "taskId"
	| "dependsOn";

const PRIORITY_SYMBOLS = Object.keys(TasksPrioritySymbolToLabel).join("");
const TASKS = TaskRegularExpressions;

/** Each field as written ("📅 2026-10-16"), and what an error calls it. */
const LINE_FIELDS: readonly (readonly [FieldKey, string, string])[] = [
	["priority", "priority", `[${PRIORITY_SYMBOLS}]\\uFE0F?`],
	["dueAt", "due date", TASKS.dueDateRegex.source],
	["startAt", "start date", TASKS.startDateRegex.source],
	["scheduledAt", "scheduled date", TASKS.scheduledDateRegex.source],
	["createdAt", "created date", TASKS.createDateRegex.source],
	["completedAt", "done date", TASKS.doneDateRegex.source],
	["cancelledAt", "cancelled date", TASKS.cancelledDateRegex.source],
	["recurringInterval", "recurrence rule", TASKS.recurrenceRegex.source],
	["onCompletion", "on-completion action", TASKS.onCompletionRegex.source],
	["taskId", "id", TASKS.idRegex.source],
	["dependsOn", "dependency", TASKS.dependsOnRegex.source],
];

/** Each field at the end of a text, with the spaces before it. */
const FIELD_AT_END = LINE_FIELDS.map(([key, , source]) => ({
	key,
	pattern: new RegExp(`(?:^|\\s+)(${source})$`, "u"),
}));
const TAG_AT_END = /(?:^|\s+)#[^\s!@#$%^&*(),.?":{}|<>]+$/u;

/** A field written on a line, and where it is with the spaces before it. */
interface LineField {
	key: FieldKey;
	/** The field as written ("📅 2026-10-16"). */
	text: string;
	start: number;
	end: number;
}

/**
 * The fields `text` ends with, in line order, found as Obsidian Tasks finds
 * fields: from the end, past tags, up to other text.
 */
function trailingFields(text: string): LineField[] {
	const rest = text.trimEnd();
	for (const { key, pattern } of FIELD_AT_END) {
		const match = pattern.exec(rest);
		if (match) {
			const text = match[1] ?? "";
			const field = { key, text, start: match.index, end: rest.length };
			return [...trailingFields(rest.slice(0, match.index)), field];
		}
	}
	const tag = TAG_AT_END.exec(rest);
	return tag ? trailingFields(rest.slice(0, tag.index)) : [];
}

/** `text` without `fields` (found in it) and the spaces before each. */
const withoutFields = (text: string, fields: readonly LineField[]): string =>
	fields.reduceRight(
		(rest, field) => rest.slice(0, field.start) + rest.slice(field.end),
		text,
	);

const valueOf = (task: Task, key: FieldKey): unknown =>
	key === "scheduledAt" ? task.extra?.["scheduledAt"] : task[key];

/** `task` with the value `from` has for `key`. */
const withValueOf = (task: Task, key: FieldKey, from: Task): Task => {
	if (key !== "scheduledAt") {
		return { ...task, [key]: from[key] };
	}
	const scheduledAt = from.extra?.["scheduledAt"];
	return { ...task, extra: { ...task.extra, scheduledAt } };
};

/** Where `fragment` is in a text, with the spaces before it. */
const fragmentPattern = (fragment: string): RegExp =>
	new RegExp(`(?:^|\\s+)${escapeRegExp(fragment)}(?=\\s|$)`);

/** Where a task line's rule `original` ("DTSTART…") starts. */
const ruleStart = (taskLine: string, original: string): number =>
	taskLine.indexOf(original, taskLine.indexOf("🔁"));

/**
 * The fields v0.8.0 left in the title right before the start date `left`
 * (see the top of this file) that the line also has after it.
 */
interface StrandedFields {
	/** Those fields, on the task line, in line order. */
	fields: LineField[];
	/** The fields after the start date, as v0.8.0 and Obsidian Tasks read them. */
	after: Task;
	/** Which fields the line has after the start date. */
	afterKeys: ReadonlySet<FieldKey>;
}

function strandedFields(taskLine: string, left: string): StrandedFields {
	const before = taskLine.slice(0, ruleStart(taskLine, "DTSTART"));
	const fragment = fragmentPattern(left).exec(before);
	if (!fragment) {
		// The start date is after the rule (typed there), so no field
		// v0.8.0 wrote is left before it.
		return { fields: [], after: untitledTask(""), afterKeys: new Set() };
	}
	const afterText = taskLine
		.slice(fragment.index + fragment[0].length)
		.trimEnd()
		.replace(TaskRegularExpressions.blockLinkRegex, "");
	const afterKeys = new Set(
		trailingFields(afterText).map((field) => field.key),
	);
	return {
		fields: trailingFields(before.slice(0, fragment.index)).filter((field) =>
			afterKeys.has(field.key),
		),
		after: parseTasksFormatItem(untitledTask(afterText.trim())),
		afterKeys,
	};
}

/**
 * `task` with the fields the line has after the start date read from there
 * (the rule aside, which is joined).
 */
const withFieldsAfterStart = (task: Task, stranded: StrandedFields): Task =>
	[...stranded.afterKeys]
		.filter((key) => key !== "recurringInterval")
		.reduce((read, key) => withValueOf(read, key, stranded.after), task);

/**
 * `task`, as read from `taskLine`, with the fields the line has after the
 * start date v0.8.0 left in its title read from there, as v0.8.0 and
 * Obsidian Tasks read them: their parsers stop at the start date, while
 * the library reads the first of a field written twice, which is one in
 * the title when it is a date.
 */
function asReadAfterStart(task: Task, taskLine: string): Task {
	const read = parseTasksFormatItem(untitledTask(bodyOf(taskLine)));
	const left =
		read.recurringInterval === "DTSTART" ? leftStartDate(read) : undefined;
	return left ? withFieldsAfterStart(task, strandedFields(taskLine, left)) : task;
}

/**
 * Checks that the joined line reads the fields after the start date as
 * v0.8.0 and Obsidian Tasks read them: a field before the start date other
 * than the ones right before it, which the line drops, would be read in
 * place of the one after it.
 */
function checkReadsFieldsAfterStart(
	line: string,
	stranded: StrandedFields,
	left: string,
): void {
	const joined = parseTasksFormatItem(untitledTask(bodyOf(line)));
	const misread = LINE_FIELDS.find(
		([key]) =>
			key !== "recurringInterval" &&
			stranded.afterKeys.has(key) &&
			!same(valueOf(joined, key), valueOf(stranded.after, key)),
	);
	if (misread) {
		throw new RepairError(
			`the title has another ${misread[1]} before "${left}", which the joined line would read in place of the one after it`,
		);
	}
}

/**
 * Joins a rule v0.8.0 split over `taskLine` ("🔁 DTSTART:…") and the line
 * below it ("RRULE:…").
 *
 * A field v0.8.0 left in the title right before the start date that the
 * line also has after it is dropped: the joined line keeps the one after
 * it, which v0.8.0 and Obsidian Tasks read.
 *
 * @returns undefined when the lines hold no split rule
 * @throws when they do but the rule can't be written as Obsidian Tasks text
 * with the same dates (COUNT, a task date out of step with the rule), or
 * the joined line would read another field than the one after the start
 * date (one written earlier in the title), with the manual fix
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
	const parsed = parseTasksFormatItem(untitledTask(body));
	const original = parsed.recurringInterval;
	if (!original?.startsWith("DTSTART")) {
		return undefined;
	}
	// A task v0.8.0 saved again: its start date is in the title.
	const left = original === "DTSTART" ? leftStartDate(parsed) : undefined;
	const stranded = left ? strandedFields(taskLine, left) : undefined;
	const strandedTexts = stranded?.fields.map((field) => field.text) ?? [];
	const read = stranded ? withFieldsAfterStart(parsed, stranded) : parsed;
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
		const at = ruleStart(taskLine, original);
		const before = taskLine.slice(0, at);
		// The stranded fields are before the start date, so taking it out
		// first leaves them where they were found.
		const joinedBefore =
			left && stranded
				? withoutFields(withoutFragment(before, left), stranded.fields)
				: before;
		const line =
			joinedBefore +
			written +
			taskLine.slice(at + original.length).trimEnd() +
			blockId;
		if (left && stranded) {
			checkReadsFieldsAfterStart(line, stranded, left);
		}
		return {
			original,
			rule,
			line,
			...(startAt ? { startAt } : {}),
			...(left ? { titleFragment: left } : {}),
			...(strandedTexts.length > 0 ? { strandedFields: strandedTexts } : {}),
		};
	} catch (error) {
		if (!(error instanceof RepairError)) throw error;
		throw new UnrepairableRuleError(
			`Cannot repair the recurrence rule v0.8.0 split over two lines ("🔁 ${original}" and "RRULE:${ruleLine[1]}"): ${error.message}. ${manualFix(original, left, strandedTexts, 'the rule as Obsidian Tasks text, such as "🔁 every week"')}`,
		);
	}
}

/** "a", "b" and "c". */
const quotedList = (texts: readonly string[]): string => {
	const quoted = texts.map((text) => `"${text}"`);
	return quoted.length > 1
		? `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`
		: quoted.join("");
};

/**
 * How to join a split rule by editing the note, taking out of the title
 * the start date v0.8.0 left there (`left`) and the fields before it the
 * line also has after it (`stranded`).
 */
function manualFix(
	original: string,
	left: string | undefined,
	stranded: readonly string[],
	replacement: string,
): string {
	const leftovers = [...stranded, ...(left ? [left] : [])];
	const removeLeftovers =
		leftovers.length > 0
			? `remove ${quotedList(leftovers)} from the title, `
			: "";
	return `Edit the note: delete the "RRULE:" line below the task, ${removeLeftovers}and replace "🔁 ${original}" with ${replacement}.`;
}

/**
 * Why a task whose rule still reads as the "DTSTART…" part of a split rule
 * can't be completed, and how to fix the note: the joined rule to write
 * (the task was read without the "RRULE:" line, which Obsidian indexed
 * apart from it), or why the rule can't be joined.
 *
 * @returns undefined when the lines hold no split rule
 */
export function splitRuleFix(
	taskLine: string,
	nextLine: string | undefined,
): string | undefined {
	let repair: SplitRuleRepair | undefined;
	try {
		repair = repairSplitRule(taskLine, nextLine);
	} catch (error) {
		// The rule can't be joined: the error is the manual fix.
		if (!(error instanceof UnrepairableRuleError)) throw error;
		return error.message;
	}
	if (!repair) {
		return undefined;
	}
	const rrule = RULE_LINE.exec(nextLine ?? "")?.[1] ?? "";
	const start = repair.startAt ? ` 🛫 ${repair.startAt}` : "";
	return `Cannot read the recurrence rule v0.8.0 split over two lines ("🔁 ${repair.original}" and "RRULE:${rrule}"): Obsidian indexed the task without the "RRULE:" line. ${manualFix(repair.original, repair.titleFragment, repair.strandedFields ?? [], `"🔁 ${repair.rule}${start}"`)} Or change the task once (in the timeline or with update_task), which joins the two lines.`;
}

/** Task fields a task line holds, other than its title and checkbox. */
const SKIPPED_FIELDS = new Set(["id", "title", "status", "tags", "extra"]);

const same = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

/** `record` without the keys whose value is undefined. */
function defined<T extends object>(record: T): T {
	return Object.fromEntries(
		Object.entries(record).filter(([, value]) => value !== undefined),
	) as T;
}

/**
 * `title` without the start date v0.8.0 left in it and, right before that,
 * the fields the joined line dropped (see
 * {@link SplitRuleRepair.strandedFields}), while the title still has them.
 */
function withoutLeftovers(title: string, repair: SplitRuleRepair): string {
	const fragment = repair.titleFragment
		? fragmentPattern(repair.titleFragment).exec(title)
		: null;
	if (!fragment) {
		return title.trim();
	}
	const stranded = new Set(repair.strandedFields ?? []);
	const head = title.slice(0, fragment.index);
	const kept = withoutFields(
		head,
		trailingFields(head).filter((field) => stranded.has(field.text)),
	);
	return (kept + title.slice(fragment.index + fragment[0].length)).trim();
}

/**
 * The task read from a line with a split rule, `splitLine`, and maybe edited
 * since, as it reads from the line the rule is joined into: with the joined
 * rule, without the start date v0.8.0 left in its title, and with what that
 * start date kept the line's parser from reading as fields (the priority,
 * dates or other fields v0.8.0 wrote before it) read as fields, except the
 * ones the line also has after it, which the joined line drops.
 *
 * Each field the task still has as read from `splitLine` (see
 * {@link withJoinedSplitRule}) takes its value from the joined line (or
 * from the title, when the title still holds it, e.g. after a rename), and
 * each field the task changed keeps the change.
 */
export function asReadFromRepairedLine(
	task: Task,
	splitLine: string,
	repair: SplitRuleRepair,
): Task {
	const splitRead = asReadAfterStart(
		parseTasksFormatItem(untitledTask(bodyOf(splitLine))),
		splitLine,
	);
	const lineRead = parseTasksFormatItem(untitledTask(bodyOf(repair.line)));
	const shownTitle = withoutLeftovers(task.title, repair);
	// Fields still in the title, read as a title without them reads.
	const typed = parseTasksFormatItem(untitledTask(shownTitle));
	const untyped = parseTasksFormatItem(untitledTask(typed.title));
	const lineValue = (key: string) => {
		const field = key as keyof Task;
		return same(typed[field], untyped[field]) ? lineRead[field] : typed[field];
	};

	const keys = new Set(
		[...Object.keys(splitRead), ...Object.keys(lineRead)].filter(
			(key) => !SKIPPED_FIELDS.has(key),
		),
	);
	const fields = Object.fromEntries(
		[...keys].map((key) => {
			const value = task[key as keyof Task];
			const unchanged = same(value, splitRead[key as keyof Task]);
			return [key, unchanged ? lineValue(key) : value];
		}),
	);
	const extraKeys = new Set([
		...Object.keys(splitRead.extra ?? {}),
		...Object.keys(lineRead.extra ?? {}),
	]);
	const extra = Object.fromEntries(
		[...extraKeys].map((key) => {
			const value = task.extra?.[key];
			const unchanged = same(value, splitRead.extra?.[key]);
			return [key, unchanged ? lineRead.extra?.[key] : value];
		}),
	);
	return defined({
		...task,
		...fields,
		title: typed.title,
		extra: defined({ ...task.extra, ...extra }),
	} as Task);
}

/**
 * Whether a task read from `rawText` was read with its split rule's second
 * line, so its rule is joined already (see {@link withJoinedSplitRule}).
 */
export function readWithRuleLine(rawText: string): boolean {
	const [, next = ""] = rawText.split("\n");
	return RULE_LINE.test(next);
}

/**
 * A task read from the vault with its split rule joined, so the timeline,
 * the agent and complete_task see the task the joined line holds. The note
 * changes only when the task is saved. A rule that can't be joined is left
 * as read: saving the task then fails with the manual fix.
 *
 * A task read without the rule's second line (Obsidian indexed it apart)
 * keeps the line's title and rule, but a field v0.8.0 left in the title
 * that the line also has after the start date reads as the one after it,
 * as v0.8.0 and Obsidian Tasks read it, and as saving it joins the lines.
 */
export function withJoinedSplitRule(task: Task): Task {
	const [line = "", next] = (task.extra?.rawText ?? "").split("\n");
	const read = asReadAfterStart(task, line);
	try {
		const repair = repairSplitRule(line, next);
		return repair ? asReadFromRepairedLine(read, line, repair) : read;
	} catch (error) {
		console.warn(error);
		return read;
	}
}
