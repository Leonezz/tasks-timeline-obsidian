import { createCapabilities } from "@tasks-timeline/components";
import type TasksTimelineObsidianPlugin from "../../src/main";
import { SecurityManager } from "../../src/mcpSecurity";
import { createObsidianCapabilityContext } from "../../src/taskCapabilities";
import { App, TFile } from "../mocks/obsidian";
import { indexFile, reindexAfterWrites } from "../helpers/testHelpers";

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
});
