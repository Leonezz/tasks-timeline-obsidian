import { Priority, TaskStatus } from "@tasks-timeline/components";

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

export const MdMarkerToTaskStatus: Record<string, TaskStatus> = {
	" ": "todo",
	x: "done",
	"/": "doing",
	"-": "cancelled",
};
export const TaskStatusCollection: TaskStatus[] = [
	"todo",
	"cancelled",
	"doing",
	"done",
	"unplanned",
	"due",
	"scheduled",
	"overdue",
];

export const getTaskStatusFromMarker = (marker: string): TaskStatus => {
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
