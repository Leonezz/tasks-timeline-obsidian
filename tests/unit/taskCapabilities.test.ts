import {
	createCapabilities,
	type Capabilities,
} from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { SecurityManager } from "../../src/mcpSecurity";
import { createObsidianCapabilityContext } from "../../src/taskCapabilities";
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
			id: "Tasks.md:1:0",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe("- [ ] Keep\n");
	});

	it("still blocks deleting tasks hidden by security rules", async () => {
		const { app, file, capabilities } = createMcpCapabilities(
			"- [ ] Keep\n- [ ] Secret #private\n",
			"tag:#private",
		);

		const { result } = await capabilities.executeTool("delete_task", {
			id: "Tasks.md:1:0",
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
			id: "Tasks.md:1:0",
		});

		const updated = await capabilities.executeTool("update_task", {
			id: "Tasks.md:1:0",
			title: "Renamed by agent",
		});

		expect(updated.result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toMatch(
			/^- \[ \] Existing\n- \[ \] Renamed by agent/,
		);
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
			expect.objectContaining({ id: "Tasks.md:0:0", status: "done" }),
			expect.objectContaining({
				id: "Tasks.md:1:0",
				status: "todo",
				dueAt: "2026-10-17",
			}),
		]);
	});

	it("refuses to complete a task the user already completed (next occurrence below)", async () => {
		const { app, file, capabilities } = createMcpCapabilities(`${DUE}\n`);
		await queryTasks(capabilities);
		await editExternally(app, "Tasks.md", `${DONE}\n${NEXT}\n`);

		const { result } = await capabilities.executeTool("complete_task", {
			id: "Tasks.md:0:0",
		});

		expect(result).toMatchObject({
			error: expect.stringMatching(/changed since it was read/),
		});
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			`${DONE}\n${NEXT}\n`,
		);
	});

	it("never overwrites the next occurrence the Tasks plugin wrote above (default)", async () => {
		const { app, file, capabilities } = createMcpCapabilities(`${DUE}\n`);
		await queryTasks(capabilities);
		await editExternally(app, "Tasks.md", `${NEXT}\n${DONE}\n`);

		const { result } = await capabilities.executeTool("complete_task", {
			id: "Tasks.md:0:0",
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
		await queryTasks(capabilities);

		const { result } = await capabilities.executeTool("update_task", {
			id: "Tasks.md:0:0",
			priority: "high",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toBe(
			`- [ ] Water plants ⏫ 📅 2026-10-17 🔁 every day\n${DONE}\n`,
		);
	});

	it("reads back its own update_task", async () => {
		const { capabilities } = createMcpCapabilities(`${DUE}\n`);
		await queryTasks(capabilities);

		await capabilities.executeTool("update_task", {
			id: "Tasks.md:0:0",
			title: "Water the plants",
		});

		expect(await queryTasks(capabilities)).toEqual([
			expect.objectContaining({
				id: "Tasks.md:0:0",
				title: "Water the plants",
			}),
		]);
	});

	it("applies consecutive updates to the same task without a new query", async () => {
		const { app, file, capabilities } = createMcpCapabilities(`${DUE}\n`);
		await queryTasks(capabilities);

		await capabilities.executeTool("update_task", {
			id: "Tasks.md:0:0",
			title: "Water the plants",
		});
		const { result } = await capabilities.executeTool("complete_task", {
			id: "Tasks.md:0:0",
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
			id: "Tasks.md:1:2",
		});

		expect(result).toMatchObject({ success: true });
		await expect(app.vault.cachedRead(file)).resolves.toMatch(
			/^> \[!todo\] Inbox\n> - \[x\] Quoted task ✅ \d{4}-\d{2}-\d{2}\n$/,
		);
	});

	it("edits it", async () => {
		const { app, file, capabilities } = createMcpCapabilities(CALLOUT);

		const { result } = await capabilities.executeTool("update_task", {
			id: "Tasks.md:1:2",
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
			id: "Tasks.md:1:2",
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
