/**
 * Unit tests for Obsidian-specific task parsers
 * (parseTasksFormatItem is tested in @tasks-timeline/components)
 */

import { Task } from "@tasks-timeline/components";
import { parseDataViewFormatItem } from "../../src/parsers";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: "test:0:0",
	title: "",
	status: "todo",
	category: "test.md",
	priority: "medium",
	tags: [],
	...overrides,
});

describe("parseDataViewFormatItem", () => {
	it("should parse dataview due date with correct month", () => {
		const task = makeTask({ title: "Task [[due:: 2026-02-27]]" });
		const result = parseDataViewFormatItem(task);

		expect(result.dueAt).toBe("2026-02-27");
	});

	it("should parse dataview created date with correct month", () => {
		const task = makeTask({ title: "Task [[created:: 2026-11-05]]" });
		const result = parseDataViewFormatItem(task);

		expect(result.createdAt).toBe("2026-11-05");
	});

	it("should parse dataview start date with correct month", () => {
		const task = makeTask({ title: "Task [[start:: 2026-06-15]]" });
		const result = parseDataViewFormatItem(task);

		expect(result.startAt).toBe("2026-06-15");
	});
});
