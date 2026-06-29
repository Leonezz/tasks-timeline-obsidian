import type { Priority, TaskStatus } from "@tasks-timeline/components";

export const TasksPrioritySymbolToLabel: Record<string, Priority> = {
	"🔺": "high",
	"⏫": "high",
	"🔼": "medium",
	"": "medium",
	"🔽": "low",
	"⏬": "low",
};

export type TasksPrioritySymbol = keyof typeof TasksPrioritySymbolToLabel;
export type PriorityLabel = string;

export const recurrenceSymbol = "🔁";
export const startDateSymbol = "🛫";
export const scheduledDateSymbol = "⏳";
export const dueDateSymbol = "📅";
export const doneDateSymbol = "✅";

export type MarkdownTaskStatus = Extract<
	TaskStatus,
	"todo" | "doing" | "done" | "cancelled"
>;

export const MdMarkerToTaskStatus: Record<string, MarkdownTaskStatus> = {
	" ": "todo",
	x: "done",
	"/": "doing",
	"-": "cancelled",
};
export const TaskStatusCollection: MarkdownTaskStatus[] = [
	"todo",
	"cancelled",
	"doing",
	"done",
];

export const getTaskStatusFromMarker = (marker: string): MarkdownTaskStatus => {
	switch (marker.trim()) {
		case "": {
			return "todo";
		}
		case "x": {
			return "done";
		}
		case "/": {
			return "doing";
		}
		case "-": {
			return "cancelled";
		}
		default: {
			return "todo";
		}
	}
};
