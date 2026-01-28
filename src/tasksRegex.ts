import { TasksPrioritySymbolToLabel } from "./symbols";

export class TaskRegularExpressions {
	public static readonly dateFormat = "yyyy-mm-dd";

	// Matches indentation before a list marker (including > for potentially nested blockquotes or Obsidian callouts)
	public static readonly indentationRegex = /^([\s\t>]*)/;

	// Matches - or * list markers, or numbered list markers (eg 1.)
	public static readonly listMarkerRegex = /([-*]|[0-9]+\.)/;

	// Matches a checkbox and saves the status character inside
	public static readonly checkboxRegex = /\[(.)\]/u;

	// Matches the rest of the task after the checkbox.
	public static readonly afterCheckboxRegex = / *(.*)/u;

	// Main regex for parsing a line. It matches the following:
	// - Indentation
	// - List marker
	// - Status character
	// - Rest of task after checkbox markdown
	public static readonly taskRegex = new RegExp(
		TaskRegularExpressions.indentationRegex.source +
			TaskRegularExpressions.listMarkerRegex.source +
			" +" +
			TaskRegularExpressions.checkboxRegex.source +
			TaskRegularExpressions.afterCheckboxRegex.source,
		"u"
	);

	// Used with the "Create or Edit Task" command to parse indentation and status if present
	public static readonly nonTaskRegex = new RegExp(
		TaskRegularExpressions.indentationRegex.source +
			TaskRegularExpressions.listMarkerRegex.source +
			"? *(" +
			TaskRegularExpressions.checkboxRegex.source +
			")?" +
			TaskRegularExpressions.afterCheckboxRegex.source,
		"u"
	);

	// Used with "Toggle Done" command to detect a list item that can get a checkbox added to it.
	public static readonly listItemRegex = new RegExp(
		TaskRegularExpressions.indentationRegex.source +
			TaskRegularExpressions.listMarkerRegex.source
	);

	// Match on block link at end.
	public static readonly blockLinkRegex = / \^[a-zA-Z0-9-]+/u;

	// The following regex's end with `$` because they will be matched and
	// removed from the end until none are left.
	public static readonly priorityRegex = RegExp(
		"([" +
			Object.keys(TasksPrioritySymbolToLabel)
				.filter((s) => s.length > 0)
				.join("") +
			"])$",
		"u"
	);

	public static readonly startDateRegex = /🛫 *(\d{4}-\d{2}-\d{2})/u;
	public static readonly createDateRegex = /➕ *(\d{4}-\d{2}-\d{2})/u;
	public static readonly scheduledDateRegex = /[⏳⌛] *(\d{4}-\d{2}-\d{2})/u;
	public static readonly dueDateRegex = /[📅📆🗓] *(\d{4}-\d{2}-\d{2})/u;
	public static readonly doneDateRegex = /✅ *(\d{4}-\d{2}-\d{2})/u;
	public static readonly recurrenceRegex = /🔁 ?([a-zA-Z0-9, !]+)/iu;

	// regex from @702573N
	public static readonly hexColorRegex =
		/([a-fA-F0-9]{6}|[a-fA-F0-9]{3})\/(.*)/;
	public static readonly TasksPluginDateRegex =
		/[🛫|⏳|📅|✅] *(\d{4}-\d{2}-\d{2})/u;

	// [[a::b]] or [[a:: b]] => a, b (space after :: is optional)
	public static readonly keyValueRegex = /\[+([^\]]+):: ?([^\]]+)\]\]/g;

	/**
	 * [a](b) => a, b (a could be empty)
	 * #1: [a](b)
	 * #2: a
	 * #3: b
	 */
	public static readonly outerLinkRegex =
		/\[((?:\[[^\]]*\]|[^[\]])*)\]\([ \t]*<?((?:\([^)]*\)|[^()\s])*?)>?[ \t]*((['"])(.*?)\5[ \t]*)?\)/g;

	public static readonly innerLinkRegex = /\[\[([^\]]+)\]\]/g;
	public static readonly highlightRegex = /==([^\]]+)==/g;
	public static readonly remainderRegex =
		/⏰ *(\d{4}-\d{2}-\d{2}) *(\d{2}:\d{2})|⏰ *(\d{4}-\d{2}-\d{2})|(\(@(\d{4}-\d{2}-\d{2}) *(\d{2}:\d{2})\))|(\(@(\d{4}-\d{2}-\d{2})\))/;
	// Regex to match all hash tags, basically hash followed by anything but the characters in the negation.
	// To ensure URLs are not caught it is looking of beginning of string tag and any
	// tag that has a space in front of it. Any # that has a character in front
	// of it will be ignored.
	// EXAMPLE:
	// description: '#dog #car http://www/ddd#ere #house'
	// matches: #dog, #car, #house
	public static readonly hashTags = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]*/g;
	public static readonly hashTagsFromEnd = new RegExp(
		this.hashTags.source + "$"
	);
}
