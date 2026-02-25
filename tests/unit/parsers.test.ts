/**
 * Unit tests for task parsers
 * Tests date parsing, priority extraction, and the full parsing pipeline
 */

import { Task } from "@tasks-timeline/components";
import {
	parseTasksFormatItem,
	parseDataViewFormatItem,
} from "../../src/parsers";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
	id: "test:0:0",
	title: "",
	status: "todo",
	category: "test.md",
	priority: "medium",
	tags: [],
	...overrides,
});

describe("parseTasksFormatItem", () => {
	describe("date parsing (yyyy-MM-dd format)", () => {
		it("should parse due date with correct month", () => {
			const task = makeTask({ title: "Interview 📅 2026-02-27" });
			const result = parseTasksFormatItem(task);

			expect(result.dueAt).toBe("2026-02-27");
		});

		it("should parse created date with correct month", () => {
			const task = makeTask({ title: "Task ➕ 2026-02-26" });
			const result = parseTasksFormatItem(task);

			expect(result.createdAt).toBe("2026-02-26");
		});

		it("should parse start date with correct month", () => {
			const task = makeTask({ title: "Task 🛫 2026-03-15" });
			const result = parseTasksFormatItem(task);

			expect(result.startAt).toBe("2026-03-15");
		});

		it("should parse scheduled date with correct month", () => {
			const task = makeTask({ title: "Task ⏳ 2026-11-05" });
			const result = parseTasksFormatItem(task);

			expect(result.extra?.["scheduledAt"]).toBe("2026-11-05");
		});

		it("should parse done date with correct month", () => {
			const task = makeTask({ title: "Task ✅ 2026-12-31" });
			const result = parseTasksFormatItem(task);

			expect(result.completedAt).toBe("2026-12-31");
		});

		it("should preserve month for all 12 months", () => {
			const months = [
				"01",
				"02",
				"03",
				"04",
				"05",
				"06",
				"07",
				"08",
				"09",
				"10",
				"11",
				"12",
			];
			for (const month of months) {
				const task = makeTask({ title: `Task 📅 2026-${month}-15` });
				const result = parseTasksFormatItem(task);
				expect(result.dueAt).toBe(`2026-${month}-15`);
			}
		});

		it("should parse multiple dates with correct months", () => {
			const task = makeTask({
				title: "Interview 📅 2026-02-27 🛫 2026-03-01 ➕ 2026-01-15",
			});
			const result = parseTasksFormatItem(task);

			expect(result.dueAt).toBe("2026-02-27");
			expect(result.startAt).toBe("2026-03-01");
			expect(result.createdAt).toBe("2026-01-15");
		});
	});

	describe("priority parsing", () => {
		it("should parse high priority", () => {
			const task = makeTask({ title: "Task 🔺" });
			const result = parseTasksFormatItem(task);

			expect(result.priority).toBe("high");
		});

		it("should parse low priority", () => {
			const task = makeTask({ title: "Task 🔽" });
			const result = parseTasksFormatItem(task);

			expect(result.priority).toBe("low");
		});

		it("should default to medium priority", () => {
			const task = makeTask({ title: "Task without priority" });
			const result = parseTasksFormatItem(task);

			expect(result.priority).toBe("medium");
		});
	});

	describe("title extraction", () => {
		it("should strip dates and priority from title", () => {
			const task = makeTask({
				title: "Interview with Rednote 🔺 📅 2026-02-27 ➕ 2026-02-26",
			});
			const result = parseTasksFormatItem(task);

			expect(result.title).toBe("Interview with Rednote");
			expect(result.dueAt).toBe("2026-02-27");
			expect(result.createdAt).toBe("2026-02-26");
			expect(result.priority).toBe("high");
		});

		it("should preserve inline tags before dates in title", () => {
			const task = makeTask({
				title: "Task #interview 📅 2026-02-27",
			});
			const result = parseTasksFormatItem(task);

			expect(result.title).toContain("#interview");
			expect(result.dueAt).toBe("2026-02-27");
		});
	});

	describe("recurrence parsing", () => {
		it("should parse recurrence rule", () => {
			const task = makeTask({ title: "Task 🔁 every week" });
			const result = parseTasksFormatItem(task);

			expect(result.recurringInterval).toBe("every week");
		});
	});
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
