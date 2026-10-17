import {
	createCapabilities,
	type Capabilities,
	type CapabilityContext,
} from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { SecurityManager } from "../../src/mcpSecurity";
import { createObsidianCapabilityContext } from "../../src/taskCapabilities";
import { taskLineVersion } from "../../src/taskLine";
import { App, TFile } from "../mocks/obsidian";
import {
	editExternally,
	indexFile,
	reindexAfterWrites,
} from "../helpers/testHelpers";

function createMcpCapabilities(content: string, blacklist = "") {
	const app = new App();
	app.vault._addFile("Tasks.md", content);
	indexFile(app, "Tasks.md", content);
	reindexAfterWrites(app);
	const file = app.vault.getAbstractFileByPath("Tasks.md");
	if (!(file instanceof TFile)) {
		throw new Error("Test file not created");
	}

	const plugin = {
		app,
		settings: {
			appSetting: {
				defaultCategory: "Tasks.md",
			},
		},
	} as unknown as TasksTimelineObsidianPlugin;

	const securityManager = new SecurityManager();
	securityManager.updateRules(blacklist);
	const ctx = createObsidianCapabilityContext(plugin, securityManager);

	return { app, file, ctx, capabilities: createCapabilities(ctx) };
}

/** The id query_tasks lists for the task titled `title`, as a client gets it. */
async function listedId(
	capabilities: Capabilities,
	title: string,
): Promise<string> {
	const { result } = await capabilities.executeTool("query_tasks", {});
	const task = (result as { tasks: { id: string; title: string }[] }).tasks.find(
		(t) => t.title === title,
	);
	if (!task) throw new Error(`No task titled ${title}`);
	return task.id;
}

describe("createObsidianCapabilityContext (MCP)", () => {
	it("skips confirmation because it is headless", () => {
		const { ctx } = createMcpCapabilities("- [ ] Existing\n");

		expect(ctx.confirm).toBeUndefined();
		expect(ctx.confirmPolicy).toBe("skip");
	});

	it("deletes a task through delete_task without a confirm callback", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Keep\n- [ ] Delete me\n",
		);

		const { result } = await capabilities.executeTool("delete_task", {
			id: await listedId(capabilities, "Delete me"),
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe("- [ ] Keep\n");
	});

	it("still blocks deleting tasks hidden by security rules", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Keep\n- [ ] Secret #private\n",
			"tag:#private",
		);

		// Listings hide the task, so a client could only guess its id.
		const { result } = await capabilities.executeTool("delete_task", {
			id: `Tasks.md:1:0~${taskLineVersion("- [ ] Secret #private")}`,
		});

		// The security manager hides the task, so the tool cannot find it.
		expect(result).toMatchObject({ success: false });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Keep\n- [ ] Secret #private\n",
		);
	});

	it("reports the stored id from create_task so update_task can use it", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Existing\n",
		);

		const created = await capabilities.executeTool("create_task", {
			title: "Created by agent",
		});
		expect(created.result).toMatchObject({
			success: true,
			id: expect.stringMatching(/^Tasks\.md:1:0~/),
		});

		const updated = await capabilities.executeTool("update_task", {
			id: (created.result as { id: string }).id,
			title: "Renamed by agent",
		});

		expect(updated.result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toMatch(
			/^- \[ \] Existing\n- \[ \] Renamed by agent/,
		);
	});
});

describe("createObsidianCapabilityContext create_task with Tasks syntax in the title (MCP)", () => {
	it("stores the typed fields as written and reports them", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Existing\n",
		);

		const { result } = await capabilities.executeTool("create_task", {
			title: "Pay rent 📅 2026-10-20 🔺",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toMatch(
			/^- \[ \] Existing\n- \[ \] Pay rent 📅 2026-10-20 🔺( ➕ \d{4}-\d{2}-\d{2})?\n$/,
		);
		const [, created] = (
			(await capabilities.executeTool("query_tasks", {})).result as {
				tasks: { title: string; dueAt?: string; priority: string }[];
			}
		).tasks;
		expect(created).toMatchObject({
			title: "Pay rent",
			dueAt: "2026-10-20",
			priority: "high",
		});
	});
});

describe("createObsidianCapabilityContext keeps task data current (MCP)", () => {
	const DUE = "- [ ] Water plants 🔁 every day 📅 2026-10-16";
	const DONE = "- [x] Water plants 🔁 every day 📅 2026-10-16 ✅ 2026-10-16";
	const NEXT = "- [ ] Water plants 🔁 every day 📅 2026-10-17";

	interface TaskSummary {
		id: string;
		title: string;
		status: string;
		dueAt?: string;
	}

	async function queryTasks(capabilities: Capabilities) {
		const { result } = await capabilities.executeTool("query_tasks", {});
		return (result as { tasks: TaskSummary[] }).tasks;
	}

	it("lists fresh tasks after the vault changes outside the plugin", async () => {
		const { app, capabilities } = createMcpCapabilities(`${DUE}\n`);
		await queryTasks(capabilities);

		await editExternally(app, "Tasks.md", `${DONE}\n${NEXT}\n`);

		expect(await queryTasks(capabilities)).toEqual([
			expect.objectContaining({
				id: expect.stringMatching(/^Tasks\.md:0:0~/),
				status: "done",
			}),
			expect.objectContaining({
				id: expect.stringMatching(/^Tasks\.md:1:0~/),
				status: "todo",
				dueAt: "2026-10-17",
			}),
		]);
	});

	it("refuses to complete a task the user already completed (next occurrence below)", async () => {
		const { app, file, capabilities } = createMcpCapabilities(`${DUE}\n`);
		const id = await listedId(capabilities, "Water plants");
		await editExternally(app, "Tasks.md", `${DONE}\n${NEXT}\n`);

		const { result } = await capabilities.executeTool("complete_task", {
			id,
		});

		// Worded for the AI client, unlike the timeline's notice.
		expect(result).toEqual({
			error: `Task ${id} changed since it was read — query tasks again.`,
		});
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			`${DONE}\n${NEXT}\n`,
		);
	});

	it("never overwrites the next occurrence the Tasks plugin wrote above (default)", async () => {
		const { app, file, capabilities } = createMcpCapabilities(`${DUE}\n`);
		const id = await listedId(capabilities, "Water plants");
		await editExternally(app, "Tasks.md", `${NEXT}\n${DONE}\n`);

		const { result } = await capabilities.executeTool("complete_task", {
			id,
		});

		expect(result).toMatchObject({
			error: expect.stringMatching(/changed since it was read/),
		});
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			`${NEXT}\n${DONE}\n`,
		);
	});

	it("acts on the fresh task once it is queried again", async () => {
		const { app, file, capabilities } = createMcpCapabilities(`${DUE}\n`);
		await queryTasks(capabilities);
		await editExternally(app, "Tasks.md", `${NEXT}\n${DONE}\n`);
		const [next] = await queryTasks(capabilities);

		const { result } = await capabilities.executeTool("update_task", {
			id: next!.id,
			priority: "high",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			// The line is edited in place: the new field goes after the last one.
			`- [ ] Water plants 🔁 every day 📅 2026-10-17 ⏫\n${DONE}\n`,
		);
	});

	it("reads back its own update_task", async () => {
		const { capabilities } = createMcpCapabilities(`${DUE}\n`);
		const id = await listedId(capabilities, "Water plants");

		await capabilities.executeTool("update_task", {
			id,
			title: "Water the plants",
		});

		expect(await queryTasks(capabilities)).toEqual([
			expect.objectContaining({
				id: expect.stringMatching(/^Tasks\.md:0:0~/),
				title: "Water the plants",
			}),
		]);
	});

	it("applies consecutive updates to the same task without a new query", async () => {
		const { app, file, capabilities } = createMcpCapabilities(`${DUE}\n`);
		const id = await listedId(capabilities, "Water plants");

		// Both calls use the id from the one listing.
		await capabilities.executeTool("update_task", {
			id,
			title: "Water the plants",
		});
		const { result } = await capabilities.executeTool("complete_task", {
			id,
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toMatch(
			/^- \[x\] Water the plants /,
		);
	});

	it("batch-updates tasks in one note once Obsidian re-indexes each write", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] First\n- [ ] Second\n",
		);

		const { result } = await capabilities.executeTool(
			"batch_update_tasks",
			{ filter: { status: "todo" }, update: { priority: "high" } },
		);

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] First ⏫\n- [ ] Second ⏫\n",
		);
	});

	it("stops watching the vault when disposed", () => {
		const { app, ctx } = createMcpCapabilities(`${DUE}\n`);
		expect(app.vault._listenerCount()).toBeGreaterThan(0);

		ctx.dispose();

		expect(app.vault._listenerCount()).toBe(0);
		expect(app.metadataCache._listenerCount()).toBe(0);
	});
});

describe("createObsidianCapabilityContext with a callout task (MCP)", () => {
	const CALLOUT = "> [!todo] Inbox\n> - [ ] Quoted task\n";

	it("completes it", async () => {
		const { app, file, capabilities } = createMcpCapabilities(CALLOUT);

		const { result } = await capabilities.executeTool("complete_task", {
			id: await listedId(capabilities, "Quoted task"),
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toMatch(
			/^> \[!todo\] Inbox\n> - \[x\] Quoted task ✅ \d{4}-\d{2}-\d{2}\n$/,
		);
	});

	it("edits it", async () => {
		const { app, file, capabilities } = createMcpCapabilities(CALLOUT);

		const { result } = await capabilities.executeTool("update_task", {
			id: await listedId(capabilities, "Quoted task"),
			title: "Renamed",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"> [!todo] Inbox\n> - [ ] Renamed\n",
		);
	});

	it("deletes it", async () => {
		const { app, file, capabilities } = createMcpCapabilities(CALLOUT);

		const { result } = await capabilities.executeTool("delete_task", {
			id: await listedId(capabilities, "Quoted task"),
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"> [!todo] Inbox\n",
		);
	});
});

describe("createObsidianCapabilityContext with a described task (MCP)", () => {
	it("deletes the task and its description", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Existing\n",
		);
		const created = await capabilities.executeTool("create_task", {
			title: "Call the bank",
			description: "Ask about fees",
		});
		const { id } = created.result as { id: string };

		const { result } = await capabilities.executeTool("delete_task", { id });

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Existing\n",
		);
	});
});

describe("createObsidianCapabilityContext recurrence (MCP)", () => {
	it("clears 🔁 when update_task clears the recurrence", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Water plants 📅 2026-10-16 🔁 every day\n",
		);

		const { result } = await capabilities.executeTool("update_task", {
			id: await listedId(capabilities, "Water plants"),
			recurrence: "",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Water plants 📅 2026-10-16\n",
		);
	});
});

describe("createObsidianCapabilityContext stores recurrence as Obsidian Tasks text (MCP)", () => {
	it("sets recurrenceFormat to text", () => {
		const { ctx } = createMcpCapabilities("- [ ] Existing\n");

		expect(ctx.recurrenceFormat).toBe("text");
	});

	it("writes an RRULE from update_task as text", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Water plants 📅 2026-10-16\n",
		);

		const { result } = await capabilities.executeTool("update_task", {
			id: await listedId(capabilities, "Water plants"),
			recurrence: "FREQ=WEEKLY;BYDAY=MO",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			"- [ ] Water plants 📅 2026-10-16 🔁 every week on Monday\n",
		);
	});

	it("rejects a rule with a start date before batch_update_tasks writes anything", async () => {
		const content = "- [ ] First 📅 2026-10-16\n- [ ] Second 📅 2026-10-16\n";
		const { app, file, capabilities } = createMcpCapabilities(content);
		const processSpy = jest.spyOn(app.vault, "process");

		const { result } = await capabilities.executeTool("batch_update_tasks", {
			filter: { status: "todo" },
			update: { recurrence: "DTSTART:20261016T000000Z\nRRULE:FREQ=WEEKLY" },
		});

		expect(JSON.stringify(result)).toMatch(/DTSTART/);
		expect(result).not.toMatchObject({ success: true });
		expect(processSpy).not.toHaveBeenCalled();
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);
	});
});

describe("createObsidianCapabilityContext with Dataview inline fields (MCP)", () => {
	it("completes a recurring task whose due date is a Dataview field after its fields", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Review 🔁 every week ➕ 2026-10-01 [[due:: 2026-10-16]]\n",
		);

		const { result } = await capabilities.executeTool("complete_task", {
			id: await listedId(capabilities, "Review"),
		});

		expect(result).toMatchObject({ success: true });
		const [done, next] = (await app.vault.cachedRead(file)).split("\n");
		expect(done).toMatch(
			/^- \[x\] Review 🔁 every week ➕ 2026-10-01 ✅ \d{4}-\d{2}-\d{2} \[\[due:: 2026-10-16\]\]$/,
		);
		// The next due date goes in the Dataview field, as on the done line.
		expect(next).toMatch(
			/^- \[ \] Review ➕ \d{4}-\d{2}-\d{2} 🔁 every week \[\[due:: 2026-10-23\]\]$/,
		);
	});
});

describe("createObsidianCapabilityContext with reminders (MCP)", () => {
	it("keeps a (@) reminder on the done line but not on the next occurrence", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Call mom 🔁 every week 📅 2026-10-16 (@2026-10-16 09:00)\n",
		);

		const { result } = await capabilities.executeTool("complete_task", {
			id: await listedId(capabilities, "Call mom"),
		});

		expect(result).toMatchObject({ success: true });
		const [done, next] = (await app.vault.cachedRead(file)).split("\n");
		expect(done).toMatch(/^- \[x\] Call mom .* \(@2026-10-16 09:00\)$/);
		// A reminder is for one occurrence, as the library treats ⏰.
		expect(next).toMatch(/^- \[ \] Call mom .*📅 2026-10-23/);
		expect(next).not.toContain("(@");
	});
});

describe("createObsidianCapabilityContext with sub-tasks (MCP)", () => {
	it("refuses to delete a parent task", async () => {
		const content = "- [ ] Parent\n\t- [ ] Child\n";
		const { app, file, capabilities } = createMcpCapabilities(content);

		const { result } = await capabilities.executeTool("delete_task", {
			id: await listedId(capabilities, "Parent"),
		});

		expect(result).toEqual({
			error: "Cannot delete task: it has sub-tasks or other nested items — delete or move them first.",
		});
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);
	});
});

describe("createObsidianCapabilityContext keeps ids bound to what was read (MCP)", () => {
	const WATER = "- [ ] Water plants 🔁 every day 📅 2026-10-16";
	const DONE = "- [x] Water plants 🔁 every day 📅 2026-10-16 ✅ 2026-10-16";
	const NEXT = "- [ ] Water plants 🔁 every day 📅 2026-10-17";
	const BEFORE = `${WATER}\n- [ ] Pay rent\n`;
	// The user completes Water plants; the Tasks plugin writes NEXT above it,
	// so "Pay rent" moves down and its old line now holds the done task.
	const AFTER = `${NEXT}\n${DONE}\n- [ ] Pay rent\n`;

	type Read = (
		capabilities: Capabilities,
		ctx: CapabilityContext,
	) => Promise<unknown>;
	const resource = (capabilities: Capabilities, uri: string) => {
		const spec = capabilities.resources.find((r) => r.uri === uri);
		if (!spec) throw new Error(`No resource ${uri}`);
		return spec.read();
	};
	const reads: [string, Read][] = [
		["get_task_stats", (c) => c.executeTool("get_task_stats", {})],
		["get_today_plan", (c) => c.executeTool("get_today_plan", {})],
		[
			"a filtered query_tasks",
			(c) => c.executeTool("query_tasks", { status: "done" }),
		],
		["tasks://all", (c) => resource(c, "tasks://all")],
		["tasks://stats", (c) => resource(c, "tasks://stats")],
		[
			"a prompt",
			async (c) => {
				const prompt = c.prompts.find((p) => p.name === "plan_my_day");
				if (!prompt) throw new Error("No plan_my_day prompt");
				return prompt.render({});
			},
		],
		[
			"a second MCP session's query",
			(_c, ctx) => createCapabilities(ctx).executeTool("query_tasks", {}),
		],
	];

	it.each(reads)(
		"refuses to delete with an id re-bound by %s",
		async (_read, read) => {
			const { app, file, ctx, capabilities } = createMcpCapabilities(BEFORE);
			const payRent = await listedId(capabilities, "Pay rent");
			await editExternally(app, "Tasks.md", AFTER);
			await read(capabilities, ctx);

			const { result } = await capabilities.executeTool("delete_task", {
				id: payRent,
			});

			expect(result).toMatchObject({
				error: expect.stringMatching(/changed since it was read/),
			});
			await expect(app.vault.cachedRead(file)).resolves.toBe(AFTER);
		},
	);

	it.each([
		["update_task", { priority: "high" }],
		["complete_task", {}],
	] as const)(
		"refuses %s with an id re-bound by another read",
		async (tool, args) => {
			const { app, file, capabilities } = createMcpCapabilities(BEFORE);
			const payRent = await listedId(capabilities, "Pay rent");
			await editExternally(app, "Tasks.md", AFTER);
			await capabilities.executeTool("get_task_stats", {});

			const { result } = await capabilities.executeTool(tool, {
				id: payRent,
				...args,
			});

			expect(result).toMatchObject({
				error: expect.stringMatching(/changed since it was read/),
			});
			await expect(app.vault.cachedRead(file)).resolves.toBe(AFTER);
		},
	);

	it("refuses an id that no listing issued", async () => {
		const { app, file, capabilities } = createMcpCapabilities(BEFORE);

		const { result } = await capabilities.executeTool("delete_task", {
			id: "Tasks.md:1:0",
		});

		expect(result).toEqual({
			error: "Unknown task id Tasks.md:1:0: use an id from query_tasks or a tasks:// resource.",
		});
		await expect(app.vault.cachedRead(file)).resolves.toBe(BEFORE);
	});

	it("reads a task through tasks://{taskId} with a listed id", async () => {
		const { capabilities } = createMcpCapabilities(BEFORE);
		const payRent = await listedId(capabilities, "Pay rent");
		const byId = capabilities.resources.find((r) => r.name === "task-by-id");

		const content = await byId!.read({ taskId: payRent });

		expect(JSON.stringify(content)).toContain("Pay rent");
	});

	it("acts on the task with the id a new listing gives it", async () => {
		const { app, file, capabilities } = createMcpCapabilities(BEFORE);
		await listedId(capabilities, "Pay rent");
		await editExternally(app, "Tasks.md", AFTER);
		const payRent = await listedId(capabilities, "Pay rent");

		const { result } = await capabilities.executeTool("delete_task", {
			id: payRent,
		});

		expect(result).toMatchObject({ success: true, title: "Pay rent" });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			`${NEXT}\n${DONE}\n`,
		);
	});
});

describe("createObsidianCapabilityContext with changes the line cannot store (MCP)", () => {
	it.each([
		["a description", { description: "Bank transfer" }, /description cannot be stored/],
		["a category", { category: "Other.md" }, /category cannot be stored/],
		[
			"a rename with a description",
			{ title: "Pay the rent", description: "Bank transfer" },
			/description cannot be stored/,
		],
	] as const)("refuses update_task with %s", async (_change, args, message) => {
		const content = "- [ ] Pay rent\n";
		const { app, file, capabilities } = createMcpCapabilities(content);

		const { result } = await capabilities.executeTool("update_task", {
			id: await listedId(capabilities, "Pay rent"),
			...args,
		});

		expect(result).toMatchObject({ error: expect.stringMatching(message) });
		await expect(app.vault.cachedRead(file)).resolves.toBe(content);
	});
});
