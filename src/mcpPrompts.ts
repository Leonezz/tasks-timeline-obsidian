import type {
	CapabilityContext,
	PromptSpec,
	Task,
} from "@tasks-timeline/components";

// --- Helpers ---

function todayISO(): string {
	const d = new Date();
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function isOverdue(dateStr: string | undefined): boolean {
	if (!dateStr) return false;
	return dateStr < todayISO();
}

function isActive(task: Task): boolean {
	return task.status !== "done" && task.status !== "cancelled";
}

function groupByCategory(tasks: Task[]): Map<string, Task[]> {
	const map = new Map<string, Task[]>();
	for (const task of tasks) {
		const key = task.category ?? "(uncategorized)";
		const group = map.get(key);
		if (group) {
			group.push(task);
		} else {
			map.set(key, [task]);
		}
	}
	return map;
}

function formatTask(task: Task): string {
	const marker =
		task.status === "done"
			? "x"
			: task.status === "doing"
				? "/"
				: task.status === "cancelled"
					? "-"
					: " ";
	const parts = [`- [${marker}] ${task.title}`];
	if (task.priority && task.priority !== "medium") {
		parts.push(`[${task.priority}]`);
	}
	if (task.dueAt) parts.push(`📅 ${task.dueAt}`);
	if (task.tags.length > 0) {
		parts.push(task.tags.map((t) => `#${t.name}`).join(" "));
	}
	if (task.category) parts.push(`(${task.category})`);
	return parts.join(" ");
}

// --- Prompt Factories ---

function createObsidianTaskGuidePrompt(ctx: CapabilityContext): PromptSpec {
	return {
		name: "obsidian_task_guide",
		description:
			"Comprehensive reference for Obsidian task syntax, conventions, and available MCP tools. Use this to understand how tasks work in this vault.",
		render() {
			const settings = ctx.getSettings?.();
			const dateFormat = settings?.dateFormat ?? "YYYY-MM-DD";
			const defaultCategory = settings?.defaultCategory ?? "Tasks.md";

			const content = `# Obsidian Task Guide

## Task Checkbox Syntax

Obsidian tasks use markdown checkboxes with special marker characters:

| Marker | Status | Example |
|--------|--------|---------|
| \`- [ ]\` | todo | \`- [ ] Buy groceries\` |
| \`- [x]\` | done | \`- [x] Send email\` |
| \`- [/]\` | doing (in progress) | \`- [/] Writing report\` |
| \`- [-]\` | cancelled | \`- [-] Old meeting\` |

## Priority Symbols

Tasks can have priority indicated by emoji symbols:

| Emoji | Priority |
|-------|----------|
| 🔺 or ⏫ | high |
| 🔼 | medium |
| 🔽 or ⏬ | low |

## Date Symbols

Dates are embedded in task lines using emoji prefixes:

| Emoji | Field | Meaning |
|-------|-------|---------|
| 🛫 | startAt | When work begins |
| 📅 | dueAt | Deadline |
| ⏳ | scheduledAt (extra) | Scheduled date |
| ✅ | completedAt | When completed |
| ➕ | createdAt | When created |
| 🔁 | recurringInterval | Recurrence rule |

**Date format**: Display format is \`${dateFormat}\`. Dates are stored as \`YYYY-MM-DD\`.

## Category = File Path

In this vault, \`task.category\` is the **vault-relative file path** where the task lives (e.g., \`Projects/WebApp.md\`). This means:
- Filtering by category = filtering by file/folder
- Moving a task to a different category = moving it to a different file
- The surrounding note, folder, project, daily note, tags, and links are often part of the user's intent

**Default category (file)**: \`${defaultCategory}\`

## Tags

Tags can appear:
- **Inline**: \`#tag\` anywhere in the task line
- **Frontmatter**: In the file's YAML frontmatter \`tags:\` field
- Tags are stored as objects with \`id\`, \`name\`, and optional \`color\`

## Dataview Inline Fields

Tasks can contain Dataview-style inline fields in the format \`[key:: value]\`. These are parsed and stored in \`task.extra\`.

## Daily Notes

Files whose name matches a date pattern are treated as daily notes. Tasks from daily notes have \`task.extra.isDailyNote === "true"\`.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| \`query_tasks\` | Query tasks with filters (status, priority, tags, category, date ranges) |
| \`get_task_stats\` | Get summary statistics about all tasks |
| \`get_today_plan\` | Get tasks relevant to today |
| \`create_task\` | Create a new task in the vault |
| \`update_task\` | Update an existing task's fields |
| \`complete_task\` | Mark a task as done |
| \`cancel_task\` | Mark a task as cancelled |
| \`delete_task\` | Remove a task from the vault |
| \`batch_update_tasks\` | Update multiple tasks at once |
| \`list_sessions\` | List active MCP sessions |

## Tips for AI Agents

- Treat user messages as task-management intent. The user may provide context from notes, meetings, projects, tags, or daily notes to identify the todo items they want manipulated.
- Use vault context when matching tasks. A task's note file path can be as important as its title, especially when several tasks have similar wording.
- Always use \`query_tasks\` with filters rather than fetching all tasks and filtering client-side
- When creating tasks, set \`category\` to the target file path; omit it to use the default (\`${defaultCategory}\`)
- Task IDs are internal identifiers — use \`query_tasks\` to discover them
- For updates, completions, cancellations, or deletes, resolve task IDs from query results and preserve unrelated task fields
- If the relevant note, project, task identity, or destructive scope is ambiguous, ask a concise clarification before changing the vault
- The \`extra\` field contains vault-specific metadata like \`isDailyNote\`, \`scheduledAt\`, \`marker\`, etc.`;

			return [{ role: "user", content }];
		},
	};
}

function createProjectReviewPrompt(ctx: CapabilityContext): PromptSpec {
	return {
		name: "project_review",
		description:
			"Review tasks grouped by file/folder (project). Shows overdue, upcoming, and per-file breakdown with actionable suggestions.",
		arguments: [
			{
				name: "path",
				description:
					"Optional vault-relative path prefix to filter tasks (e.g., 'Projects/' or 'Work/Q1.md')",
				required: false,
			},
		],
		async render(args) {
			const pathFilter = args?.path;
			const today = todayISO();
			const allTasks = await ctx.getTasks();

			const tasks = pathFilter
				? allTasks.filter(
						(t) => t.category && t.category.startsWith(pathFilter),
					)
				: allTasks;

			const active = tasks.filter(isActive);
			const completed = tasks.filter((t) => t.status === "done");
			const overdue = active.filter((t) => isOverdue(t.dueAt));

			const sevenDaysLater = new Date();
			sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
			const sevenDaysISO = sevenDaysLater.toISOString().slice(0, 10);
			const upcoming = active.filter(
				(t) => t.dueAt && t.dueAt >= today && t.dueAt <= sevenDaysISO,
			);

			const lines: string[] = [];
			const scopeLabel = pathFilter
				? `Project Review: ${pathFilter}`
				: "Vault-Wide Project Review";
			lines.push(`# ${scopeLabel}\n`);
			lines.push(`**Date**: ${today}\n`);
			lines.push(`## Overview\n`);
			lines.push(`- **Active tasks**: ${active.length}`);
			lines.push(`- **Completed tasks**: ${completed.length}`);
			lines.push(`- **Overdue tasks**: ${overdue.length}`);
			lines.push(`- **Due within 7 days**: ${upcoming.length}\n`);

			if (overdue.length > 0) {
				lines.push(`## Overdue Tasks\n`);
				for (const t of overdue) {
					lines.push(formatTask(t));
				}
				lines.push("");
			}

			if (upcoming.length > 0) {
				lines.push(`## Upcoming (Next 7 Days)\n`);
				for (const t of upcoming) {
					lines.push(formatTask(t));
				}
				lines.push("");
			}

			const grouped = groupByCategory(active);
			if (grouped.size > 0) {
				lines.push(`## Per-File Breakdown\n`);
				for (const [category, catTasks] of grouped) {
					lines.push(`### ${category} (${catTasks.length} active)\n`);
					for (const t of catTasks.slice(0, 15)) {
						lines.push(formatTask(t));
					}
					if (catTasks.length > 15) {
						lines.push(
							`... and ${catTasks.length - 15} more tasks`,
						);
					}
					lines.push("");
				}
			}

			lines.push(
				"---\nPlease analyze the tasks above and suggest:\n1. Which overdue tasks need immediate attention\n2. Tasks that could be reprioritized or delegated\n3. Files/projects that seem stalled\n4. Recommended next actions",
			);

			return [{ role: "user", content: lines.join("\n") }];
		},
	};
}

function createDailyNoteTasksPrompt(ctx: CapabilityContext): PromptSpec {
	return {
		name: "daily_note_tasks",
		description:
			"Plan your day by reviewing tasks from daily notes, tasks due today, and overdue carry-forwards.",
		arguments: [
			{
				name: "date",
				description:
					"Target date in YYYY-MM-DD format (defaults to today)",
				required: false,
			},
		],
		async render(args) {
			const targetDate = args?.date ?? todayISO();
			const allTasks = await ctx.getTasks();

			// Tasks from daily notes matching target date
			const dailyNoteTasks = allTasks.filter(
				(t) =>
					t.extra?.isDailyNote === "true" &&
					(t.dueAt === targetDate ||
						t.startAt === targetDate ||
						t.createdAt === targetDate),
			);

			// Other tasks due on that date (not from daily notes)
			const otherDueTasks = allTasks.filter(
				(t) =>
					t.extra?.isDailyNote !== "true" &&
					(t.dueAt === targetDate || t.startAt === targetDate),
			);

			// Overdue carry-forwards (active tasks past due before target date)
			const overdue = allTasks
				.filter(
					(t) =>
						isActive(t) &&
						t.dueAt !== undefined &&
						t.dueAt < targetDate,
				)
				.slice(0, 20);

			const lines: string[] = [];
			lines.push(`# Daily Planning: ${targetDate}\n`);

			if (dailyNoteTasks.length > 0) {
				lines.push(`## Tasks from Daily Notes\n`);
				for (const t of dailyNoteTasks) {
					lines.push(formatTask(t));
				}
				lines.push("");
			}

			if (otherDueTasks.length > 0) {
				lines.push(`## Other Tasks Due Today\n`);
				for (const t of otherDueTasks) {
					lines.push(formatTask(t));
				}
				lines.push("");
			}

			if (overdue.length > 0) {
				lines.push(`## Overdue Carry-Forward (max 20)\n`);
				for (const t of overdue) {
					lines.push(formatTask(t));
				}
				lines.push("");
			}

			const totalCount =
				dailyNoteTasks.length + otherDueTasks.length + overdue.length;
			if (totalCount === 0) {
				lines.push(
					"*No tasks found for this date. Your schedule is clear!*\n",
				);
			}

			lines.push(
				"---\nPlease help me plan my day by:\n1. Prioritizing the tasks above by urgency and importance\n2. Suggesting a reasonable schedule or order of work\n3. Identifying any overdue tasks that should be rescheduled vs. tackled today\n4. Flagging any conflicts or overcommitments",
			);

			return [{ role: "user", content: lines.join("\n") }];
		},
	};
}

function createTagWorkflowReviewPrompt(ctx: CapabilityContext): PromptSpec {
	return {
		name: "tag_workflow_review",
		description:
			"Review all tasks with a specific tag, grouped by status, with workflow improvement suggestions.",
		arguments: [
			{
				name: "tag",
				description:
					"The tag to review (e.g., '#work' or 'work' — '#' prefix is optional)",
				required: true,
			},
		],
		async render(args) {
			const rawTag = args?.tag ?? "";
			const normalizedTag = rawTag.startsWith("#")
				? rawTag.slice(1)
				: rawTag;

			if (!normalizedTag) {
				return [
					{
						role: "user",
						content:
							"Error: Please provide a tag name to review (e.g., 'work' or '#work').",
					},
				];
			}

			const allTasks = await ctx.getTasks();
			const tagged = allTasks.filter((t) =>
				t.tags.some(
					(tag) =>
						tag.name === normalizedTag ||
						tag.name === `#${normalizedTag}`,
				),
			);

			if (tagged.length === 0) {
				return [
					{
						role: "user",
						content: `# Tag Review: #${normalizedTag}\n\nNo tasks found with this tag.`,
					},
				];
			}

			// Group by status
			const byStatus = new Map<string, Task[]>();
			for (const t of tagged) {
				const group = byStatus.get(t.status);
				if (group) {
					group.push(t);
				} else {
					byStatus.set(t.status, [t]);
				}
			}

			const overdue = tagged.filter(
				(t) => isActive(t) && isOverdue(t.dueAt),
			);
			const activeTasks = tagged.filter(isActive);
			const completedTasks = tagged.filter((t) => t.status === "done");

			const lines: string[] = [];
			lines.push(`# Tag Workflow Review: #${normalizedTag}\n`);
			lines.push(`## Summary\n`);
			lines.push(`- **Total tasks**: ${tagged.length}`);
			lines.push(`- **Active**: ${activeTasks.length}`);
			lines.push(`- **Completed**: ${completedTasks.length}`);
			lines.push(`- **Overdue**: ${overdue.length}\n`);

			// Status breakdown
			lines.push(`## Status Breakdown\n`);
			for (const [status, tasks] of byStatus) {
				lines.push(`- **${status}**: ${tasks.length}`);
			}
			lines.push("");

			if (overdue.length > 0) {
				lines.push(`## Overdue\n`);
				for (const t of overdue) {
					lines.push(formatTask(t));
				}
				lines.push("");
			}

			// Active tasks by status (exclude done/cancelled)
			const activeStatuses = [
				"doing",
				"todo",
				"due",
				"scheduled",
				"unplanned",
				"overdue",
			];
			for (const status of activeStatuses) {
				const statusTasks = byStatus.get(status);
				if (statusTasks && statusTasks.length > 0) {
					lines.push(
						`## ${status.charAt(0).toUpperCase() + status.slice(1)} (${statusTasks.length})\n`,
					);
					for (const t of statusTasks) {
						lines.push(formatTask(t));
					}
					lines.push("");
				}
			}

			// Completed (capped at 10)
			if (completedTasks.length > 0) {
				lines.push(
					`## Completed (${completedTasks.length} total, showing up to 10)\n`,
				);
				for (const t of completedTasks.slice(0, 10)) {
					lines.push(formatTask(t));
				}
				if (completedTasks.length > 10) {
					lines.push(
						`... and ${completedTasks.length - 10} more completed tasks`,
					);
				}
				lines.push("");
			}

			lines.push(
				"---\nPlease analyze this tag's workflow and suggest:\n1. Tasks that are blocked or stalled\n2. Whether the tag is being used consistently\n3. Priority adjustments for active tasks\n4. Workflow improvements for this category of work",
			);

			return [{ role: "user", content: lines.join("\n") }];
		},
	};
}

// --- Public API ---

export function createObsidianPrompts(ctx: CapabilityContext): PromptSpec[] {
	return [
		createObsidianTaskGuidePrompt(ctx),
		createProjectReviewPrompt(ctx),
		createDailyNoteTasksPrompt(ctx),
		createTagWorkflowReviewPrompt(ctx),
	];
}
