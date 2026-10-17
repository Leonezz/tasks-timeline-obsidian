import type { CapabilityContext } from "@tasks-timeline/components";
import { createObsidianPrompts } from "../../src/mcpPrompts";
import { OBSIDIAN_AI_SYSTEM_PROMPT } from "../../src/obsidianAdapter";

jest.mock("../../src/obsidianDom", () => ({
	getActiveWindow: () => window,
	getActiveDocument: () => document,
}));

async function taskGuide(): Promise<string> {
	const ctx = {
		getTasks: async () => [],
		getSettings: () => undefined,
	} as unknown as CapabilityContext;
	const guide = createObsidianPrompts(ctx).find(
		(prompt) => prompt.name === "obsidian_task_guide",
	);
	const [message] = await guide!.render({});
	return message!.content;
}

describe("obsidian_task_guide (MCP)", () => {
	it.each([
		["the cancelled date", "❌"],
		["the on-completion action", "🏁"],
		["Tasks ids", "🆔"],
		["dependencies", "⛔"],
		["the Dataview format", "[[key:: value]]"],
		["notes after the fields", "extra.lineNotes"],
		["issued ids", "~<version>"],
		["rules without a start date", "DTSTART"],
		["a 🔁 run into other text", "every day at 9:30"],
		["(@) reminders", "(@2026-10-16 09:00)"],
	])("documents %s", async (_topic, text) => {
		expect(await taskGuide()).toContain(text);
	});

	it("no longer documents the single-bracket Dataview form", async () => {
		expect(await taskGuide()).not.toContain("`[key:: value]`");
	});

	it("says that taskId is not the tool id", async () => {
		expect(await taskGuide()).toMatch(/taskId.*not the `id`/);
	});
});

describe("the in-app agent's Obsidian prompt", () => {
	it.each([
		["❌"],
		["🏁"],
		["🆔"],
		["⛔"],
		["taskId"],
		["extra.lineNotes"],
		["[[key:: value]]"],
		["DTSTART"],
		["every day at 9:30"],
	])("mentions %s", (text) => {
		expect(OBSIDIAN_AI_SYSTEM_PROMPT).toContain(text);
	});
});
