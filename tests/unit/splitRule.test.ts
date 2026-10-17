import { parseTasksFormatItem, type Task } from "@tasks-timeline/components";
import { DateTime } from "luxon";
import {
	asReadFromRepairedLine,
	repairSplitRule,
	splitRuleFix,
} from "../../src/splitRule";
import { LEFT_START, RULE_LINE } from "../fixtures/v080SplitRules";

/** DTSTART as v0.8.0's editor wrote it: local midnight, in UTC. */
const dtstart = (date: string) =>
	`DTSTART:${DateTime.fromISO(date).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`;
/** UNTIL as v0.8.0's editor wrote it: the local end of the day, in UTC. */
const until = (date: string) =>
	DateTime.fromISO(date).endOf("day").toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");

describe("repairSplitRule", () => {
	it.each([
		[
			"a weekly rule, with the day from DTSTART",
			"📅 2026-10-16",
			"FREQ=WEEKLY;INTERVAL=1",
			"every week on Friday",
		],
		[
			"a weekly rule with days",
			"📅 2026-10-16",
			"FREQ=WEEKLY;BYDAY=MO,WE",
			"every week on Monday, Wednesday",
		],
		[
			"a monthly rule, with the day from DTSTART",
			"📅 2026-10-16",
			"FREQ=MONTHLY",
			"every month on the 16th",
		],
		[
			"a yearly rule, with the date from DTSTART",
			"📅 2026-10-16",
			"FREQ=YEARLY",
			"every October on the 16th",
		],
		["a daily rule", "📅 2026-10-16", "FREQ=DAILY", "every day"],
		[
			"a rule with an end date",
			"📅 2026-10-16",
			`FREQ=WEEKLY;UNTIL=${until("2026-12-31")}`,
			"every week on Friday until December 31, 2026",
		],
		[
			"a rule that skips weeks, in step with the due date",
			"📅 2026-10-30",
			"FREQ=WEEKLY;INTERVAL=2",
			"every 2 weeks on Friday",
		],
	])("joins %s", (_kind, fields, rrule, text) => {
		const repair = repairSplitRule(
			`- [ ] Report ${fields} 🔁 ${dtstart("2026-10-16")}`,
			`RRULE:${rrule}`,
		);

		expect(repair).toEqual({
			original: dtstart("2026-10-16"),
			rule: text,
			line: `- [ ] Report ${fields} 🔁 ${text}`,
		});
	});

	it.each([
		["DTSTART;VALUE=DATE:20261016"],
		["DTSTART:20261016"],
		["DTSTART:20261016T090000"],
		["DTSTART;TZID=Asia/Tokyo:20261016T090000"],
	])("reads the day of %s as written", (start) => {
		const repair = repairSplitRule(
			`- [ ] Report 📅 2026-10-16 🔁 ${start}`,
			"RRULE:FREQ=WEEKLY",
		);

		expect(repair?.rule).toBe("every week on Friday");
	});

	it("adds the start date to a task with no date, so the rule keeps it", () => {
		const repair = repairSplitRule(
			`- [ ] Report 🔁 ${dtstart("2026-10-16")}`,
			"RRULE:FREQ=WEEKLY",
		);

		expect(repair).toMatchObject({
			startAt: "2026-10-16",
			line: "- [ ] Report 🔁 every week on Friday 🛫 2026-10-16",
		});
	});

	it("moves a block id from the rule's line to the task line", () => {
		const repair = repairSplitRule(
			`> - [ ] Report 📅 2026-10-16 🔁 ${dtstart("2026-10-16")}`,
			"RRULE:FREQ=WEEKLY ^report",
		);

		expect(repair?.line).toBe(
			"> - [ ] Report 📅 2026-10-16 🔁 every week on Friday ^report",
		);
	});

	it.each([
		["a task line without a DTSTART rule", "- [ ] Report 🔁 every week", "RRULE:FREQ=WEEKLY"],
		["a DTSTART rule without an RRULE line", `- [ ] Report 🔁 ${dtstart("2026-10-16")}`, "- [ ] Next"],
		["the last line", `- [ ] Report 🔁 ${dtstart("2026-10-16")}`, undefined],
		["an RRULE line with other text", `- [ ] Report 🔁 ${dtstart("2026-10-16")}`, "RRULE:FREQ=WEEKLY and notes"],
	])("leaves %s alone", (_kind, line, next) => {
		expect(repairSplitRule(line, next)).toBeUndefined();
	});

	it.each([
		["COUNT", "📅 2026-10-16", "FREQ=WEEKLY;COUNT=5", /COUNT/],
		[
			"a rule that skips weeks, out of step with the due date",
			"📅 2026-10-23",
			"FREQ=WEEKLY;INTERVAL=2",
			/every 2 weeks from 2026-10-16/,
		],
		[
			"a due date before the rule starts",
			"📅 2026-10-09",
			"FREQ=WEEKLY",
			/before the rule starts on 2026-10-16/,
		],
		["an hourly rule", "📅 2026-10-16", "FREQ=HOURLY", /HOURLY/],
	])("refuses %s with the manual fix", (_kind, fields, rrule, reason) => {
		const line = `- [ ] Report ${fields} 🔁 ${dtstart("2026-10-16")}`;

		expect(() => repairSplitRule(line, `RRULE:${rrule}`)).toThrow(reason);
		expect(() => repairSplitRule(line, `RRULE:${rrule}`)).toThrow(
			/Cannot repair the recurrence rule v0\.8\.0 split over two lines.*delete the "RRULE:" line below the task/,
		);
	});
});

/*
 * v0.8.0 read "🔁 DTSTART:20261015T160000Z" as the rule "DTSTART" and left
 * ":20261015T160000Z" in the title, so saving such a task again under
 * v0.8.0 wrote the start date into the title and "🔁 DTSTART" after the
 * fields, with the "RRULE:" line still below.
 */
describe("repairSplitRule on a line v0.8.0 saved again", () => {
	/** What v0.8.0 left of DTSTART in the title. */
	const fragment = (start: string) => start.slice("DTSTART".length);

	it.each([
		["a done task", "- [x]", "📅 2026-10-16 ✅ 2026-10-17"],
		["a renamed task", "- [ ]", "📅 2026-10-16"],
	])("joins the start date left in the title of %s", (_kind, box, fields) => {
		const start = dtstart("2026-10-16");
		const repair = repairSplitRule(
			`${box} Report  ${fragment(start)} ${fields} 🔁 DTSTART`,
			"RRULE:FREQ=WEEKLY;INTERVAL=1",
		);

		expect(repair).toEqual({
			original: "DTSTART",
			rule: "every week on Friday",
			titleFragment: fragment(start),
			line: `${box} Report ${fields} 🔁 every week on Friday`,
		});
	});

	it.each([
		[";VALUE=DATE:20261016"],
		[":20261016T090000"],
		[";TZID=Asia/Tokyo:20261016T090000"],
	])("reads a start date left as %s", (left) => {
		const repair = repairSplitRule(
			`- [ ] Report  ${left} 📅 2026-10-16 🔁 DTSTART`,
			"RRULE:FREQ=WEEKLY",
		);

		expect(repair).toMatchObject({
			rule: "every week on Friday",
			line: "- [ ] Report 📅 2026-10-16 🔁 every week on Friday",
		});
	});

	it("refuses a rule whose start date is gone, saying so", () => {
		const line = "- [ ] Weekly report 📅 2026-10-16 🔁 DTSTART";

		expect(() => repairSplitRule(line, "RRULE:FREQ=WEEKLY")).toThrow(
			/"🔁 DTSTART" has lost its start date.*delete the "RRULE:" line below the task, and replace "🔁 DTSTART" with the rule/,
		);
	});

	it("refuses a rule it can't join, with the start date to remove from the title", () => {
		const left = fragment(dtstart("2026-10-16"));
		const line = `- [ ] Report  ${left} 📅 2026-10-16 🔁 DTSTART`;

		expect(() => repairSplitRule(line, "RRULE:FREQ=WEEKLY;COUNT=5")).toThrow(
			new RegExp(
				`COUNT.*delete the "RRULE:" line below the task, remove "${left}" from the title, and replace "🔁 DTSTART"`,
			),
		);
	});
});

describe("asReadFromRepairedLine", () => {
	const LINE = `- [ ] Report ⏫  ${LEFT_START} 📅 2026-10-16 🔁 DTSTART`;
	const repair = repairSplitRule(LINE, RULE_LINE)!;
	/** The task as read from LINE alone. */
	const asRead: Task = parseTasksFormatItem({
		id: "Tasks.md:0:0",
		title: LINE.slice("- [ ] ".length),
		status: "todo",
		priority: "medium",
		tags: [],
	});

	it("reads the priority v0.8.0 wrote before the start date", () => {
		expect(asRead).toMatchObject({ title: `Report ⏫  ${LEFT_START}`, priority: "medium" });

		expect(asReadFromRepairedLine(asRead, LINE, repair)).toMatchObject({
			title: "Report",
			priority: "high",
			dueAt: "2026-10-16",
			isRecurring: true,
			recurringInterval: "every week on Friday",
		});
	});

	it.each([
		["a priority", { priority: "low" as const }, { title: "Report", priority: "low" }],
		["a due date", { dueAt: "2026-10-23" }, { priority: "high", dueAt: "2026-10-23" }],
		["a rule", { recurringInterval: "every month" }, { priority: "high", recurringInterval: "every month" }],
		["a title without the priority", { title: "Weekly report" }, { title: "Weekly report", priority: "high" }],
		["a title with the start date", { title: `Weekly report ⏫  ${LEFT_START}` }, { title: "Weekly report", priority: "high" }],
	])("keeps an edit of %s", (_kind, edit, expected) => {
		expect(
			asReadFromRepairedLine({ ...asRead, ...edit }, LINE, repair),
		).toMatchObject(expected);
	});
});

describe("splitRuleFix", () => {
	it("names the joined rule to write and the start date to remove", () => {
		const fix = splitRuleFix(
			`- [ ] Report  ${LEFT_START} 🔁 DTSTART`,
			RULE_LINE,
		);

		expect(fix).toBe(
			`Cannot read the recurrence rule v0.8.0 split over two lines ("🔁 DTSTART" and "${RULE_LINE}"): Obsidian indexed the task without the "RRULE:" line. Edit the note: delete the "RRULE:" line below the task, remove "${LEFT_START}" from the title, and replace "🔁 DTSTART" with "🔁 every week on Friday 🛫 2026-10-16". Or change the task once (in the timeline or with update_task), which joins the two lines.`,
		);
	});

	it("says why a rule can't be joined", () => {
		expect(
			splitRuleFix(
				`- [ ] Report  ${LEFT_START} 📅 2026-10-16 🔁 DTSTART`,
				"RRULE:FREQ=WEEKLY;COUNT=5",
			),
		).toMatch(/COUNT.*delete the "RRULE:" line below the task/);
	});

	it("is undefined for a line without a split rule", () => {
		expect(splitRuleFix("- [ ] Report 🔁 every week", RULE_LINE)).toBeUndefined();
	});
});
