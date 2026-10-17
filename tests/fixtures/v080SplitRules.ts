import type { Task } from "@tasks-timeline/components";
import { DateTime } from "luxon";

/*
 * Task lines with a recurrence rule @tasks-timeline/components v0.8.0 split
 * over two lines, as v0.8.0 saved them again.
 *
 * Generated with the plugin at 7c841bb (origin/master, library v0.8.0):
 * v0.8.0's editor wrote the rule with rrule's toString()
 * ("DTSTART:20261015T160000Z\nRRULE:FREQ=WEEKLY;INTERVAL=1"), its
 * taskToMarkdown wrote that onto "- [ ] Report", and master's
 * ObsidianTasksRepo.updateTask saved the task again after a tick, a rename,
 * a reschedule or a priority change. v0.8.0 wrote ⏫ / 🔽 before 📅, and
 * its parser stopped at the DTSTART fragment, so a priority it wrote stays
 * in the title before the fragment. The lines were generated in UTC+8
 * ("20261015T160000Z" is midnight on 2026-10-16 there); here the fragment
 * is local midnight in UTC, as v0.8.0's editor wrote it in any zone.
 *
 * The "typed" lines have what the Tasks plugin, or a hand edit, put before
 * the rule ahead of v0.8.0's save: the other priorities, a tag and a date.
 */

/** What v0.8.0 left of DTSTART in the title: ":20261015T160000Z" in UTC+8. */
export const LEFT_START = `:${DateTime.fromISO("2026-10-16")
	.toUTC()
	.toFormat("yyyyMMdd'T'HHmmss'Z'")}`;

/** The rule's second line, below each task line. */
export const RULE_LINE = "RRULE:FREQ=WEEKLY;INTERVAL=1";

export interface ResavedSplitRule {
	name: string;
	/** The task line, above {@link RULE_LINE}. */
	line: string;
	/** The task as read with the rule joined. */
	read: Partial<Task> & { scheduledAt?: string; tagNames?: string[] };
	/** The line the two lines are joined into. */
	repaired: string;
}

export const RESAVED_SPLIT_RULES: ResavedSplitRule[] = [
	{
		name: "high priority, ticked",
		line: `- [x] Report ⏫  ${LEFT_START} 📅 2026-10-16 ✅ 2026-10-17 🔁 DTSTART`,
		read: {
			title: "Report",
			priority: "high",
			status: "done",
			dueAt: "2026-10-16",
			completedAt: "2026-10-17",
		},
		repaired:
			"- [x] Report ⏫ 📅 2026-10-16 ✅ 2026-10-17 🔁 every week on Friday",
	},
	{
		name: "low priority, renamed",
		line: `- [ ] Weekly report 🔽  ${LEFT_START} 📅 2026-10-16 🔁 DTSTART`,
		read: { title: "Weekly report", priority: "low", dueAt: "2026-10-16" },
		repaired: "- [ ] Weekly report 🔽 📅 2026-10-16 🔁 every week on Friday",
	},
	{
		name: "a tag, rescheduled",
		line: `- [ ] Report  ${LEFT_START} #work 📅 2026-10-23 🔁 DTSTART`,
		read: {
			title: "Report",
			priority: "medium",
			dueAt: "2026-10-23",
			tagNames: ["#work"],
		},
		repaired: "- [ ] Report #work 📅 2026-10-23 🔁 every week on Friday",
	},
	{
		name: "priority set after the save",
		line: `- [ ] Report  ${LEFT_START} ⏫ 📅 2026-10-16 🔁 DTSTART`,
		read: { title: "Report", priority: "high", dueAt: "2026-10-16" },
		repaired: "- [ ] Report ⏫ 📅 2026-10-16 🔁 every week on Friday",
	},
	{
		name: "high priority, set again after the save",
		line: `- [ ] Report ⏫  ${LEFT_START} ⏫ 📅 2026-10-16 🔁 DTSTART`,
		read: { title: "Report", priority: "high", dueAt: "2026-10-16" },
		repaired: "- [ ] Report ⏫ ⏫ 📅 2026-10-16 🔁 every week on Friday",
	},
	{
		name: "high priority and every date, ticked",
		line: `- [x] Report ⏫     ${LEFT_START} 📅 2026-10-16 🛫 2026-10-10 ⏳ 2026-10-12 ➕ 2026-10-01 ✅ 2026-10-17 🔁 DTSTART`,
		read: {
			title: "Report",
			priority: "high",
			status: "done",
			dueAt: "2026-10-16",
			startAt: "2026-10-10",
			scheduledAt: "2026-10-12",
			createdAt: "2026-10-01",
			completedAt: "2026-10-17",
		},
		repaired:
			"- [x] Report ⏫ 📅 2026-10-16 🛫 2026-10-10 ⏳ 2026-10-12 ➕ 2026-10-01 ✅ 2026-10-17 🔁 every week on Friday",
	},
	{
		name: "low priority and no date, ticked",
		line: `- [x] Report 🔽 ${LEFT_START} ✅ 2026-10-17 🔁 DTSTART`,
		read: {
			title: "Report",
			priority: "low",
			status: "done",
			startAt: "2026-10-16",
			completedAt: "2026-10-17",
		},
		repaired:
			"- [x] Report 🔽 ✅ 2026-10-17 🔁 every week on Friday 🛫 2026-10-16",
	},
	{
		name: "typed highest priority",
		line: `- [ ] Report 🔺  ${LEFT_START} 📅 2026-10-16 🔁 DTSTART`,
		read: { title: "Report", priority: "high", dueAt: "2026-10-16" },
		repaired: "- [ ] Report 🔺 📅 2026-10-16 🔁 every week on Friday",
	},
	{
		name: "typed medium priority",
		line: `- [ ] Report 🔼  ${LEFT_START} 📅 2026-10-16 🔁 DTSTART`,
		read: { title: "Report", priority: "medium", dueAt: "2026-10-16" },
		repaired: "- [ ] Report 🔼 📅 2026-10-16 🔁 every week on Friday",
	},
	{
		name: "typed lowest priority",
		line: `- [ ] Report ⏬  ${LEFT_START} 📅 2026-10-16 🔁 DTSTART`,
		read: { title: "Report", priority: "low", dueAt: "2026-10-16" },
		repaired: "- [ ] Report ⏬ 📅 2026-10-16 🔁 every week on Friday",
	},
	{
		name: "a typed tag, start date and priority",
		line: `- [ ] Report #work 🛫 2026-10-10 ⏫  ${LEFT_START} 📅 2026-10-16 🔁 DTSTART`,
		read: {
			title: "Report",
			priority: "high",
			dueAt: "2026-10-16",
			startAt: "2026-10-10",
			tagNames: ["#work"],
		},
		repaired:
			"- [ ] Report #work 🛫 2026-10-10 ⏫ 📅 2026-10-16 🔁 every week on Friday",
	},
];

/** The fields of `task` a fixture's `read` names, for comparing. */
export function readFieldsOf(
	task: Task,
	read: ResavedSplitRule["read"],
): Record<string, unknown> {
	const { tagNames, scheduledAt, ...fields } = read;
	return {
		...Object.fromEntries(
			Object.keys(fields).map((key) => [key, task[key as keyof Task]]),
		),
		...(scheduledAt !== undefined
			? { scheduledAt: task.extra?.["scheduledAt"] }
			: {}),
		...(tagNames !== undefined
			? { tagNames: task.tags.map((tag) => tag.name) }
			: {}),
	};
}

