import { locateTaskBlock } from "../../src/taskLine";

/**
 * A note and the task's list item in it, as Obsidian 1.12 indexes it: the
 * item's first and last line, from `metadataCache.computeMetadataAsync`.
 */
interface IndexedNote {
	name: string;
	content: string;
	item: [number, number];
}

const isBlank = (line: string) => line.replace(/[\s>]/g, "") === "";

/** What the repository stores for a task read when the item ended at `last`. */
function readTask(content: string, first: number, last: number) {
	const lines = content.split("\n");
	return {
		lines,
		rawText: lines.slice(first, last + 1).join("\n"),
		position: JSON.stringify({
			start: { line: first, col: 0, offset: 0 },
			end: { line: last, col: 0, offset: 0 },
		}),
	};
}

/** The item's last line before its final content line was added. */
function lastLineBefore(content: string, [first, last]: [number, number]) {
	const lines = content.split("\n");
	let line = last - 1;
	while (line > first && isBlank(lines[line] ?? "")) line--;
	return line;
}

/** Lines Obsidian counts as part of the task's item. */
const COUNTED: IndexedNote[] = [
	{ name: "a tab-indented line", content: "- [ ] Task\n\tDetails\n", item: [0, 1] },
	{ name: "a line indented to the content", content: "- [ ] Task\n  Details\n", item: [0, 1] },
	{ name: "a line indented by one space", content: "- [ ] Task\n Details\n", item: [0, 1] },
	{ name: "a lazy line", content: "- [ ] Task\nlazy text\n- [ ] Next\n", item: [0, 1] },
	{ name: "a lazy line after a description", content: "- [ ] Task\n\tdesc\nlazy text\n", item: [0, 2] },
	{ name: "a lazy line after a code block", content: "- [ ] Task\n\tdesc\n  ```\n  code\n  ```\nlazy\n", item: [0, 5] },
	{ name: "a quoted lazy line", content: "> - [ ] Task\n> lazy\n", item: [0, 1] },
	{ name: "a quoted line without a space", content: "> - [ ] Task\n>lazy\n", item: [0, 1] },
	{ name: "a callout description", content: "> [!todo] Inbox\n> - [ ] Task\n> \tdesc\n", item: [1, 2] },
	{ name: "a tab after the quote", content: "> - [ ] Task\n>\tdesc\n", item: [0, 1] },
	{ name: "a paragraph after a blank line", content: "- [ ] Task\n\n\tpara\n", item: [0, 2] },
	{ name: "a paragraph after two blank lines", content: "- [ ] Task\n\n\n  two\n", item: [0, 3] },
	{ name: "a quoted paragraph after a blank line", content: "> - [ ] Task\n>\n>   two\n", item: [0, 2] },
	{ name: "a numbered task's paragraph", content: "1. [ ] Task\n\n   three\n", item: [0, 2] },
	{ name: "a numbered task's lazy line", content: "1. [ ] Task\n  two\n", item: [0, 1] },
	{ name: "a heading indented to the content", content: "- [ ] Task\n  # H\n", item: [0, 1] },
	{ name: "a heading indented by three spaces", content: "- [ ] Task\n   # H\n", item: [0, 1] },
	{ name: "an indented thematic break", content: "- [ ] Task\n  ***\n", item: [0, 1] },
	{ name: "an indented code block", content: "- [ ] Task\n  ```\n  code\n  ```\n", item: [0, 3] },
	{ name: "a tag", content: "- [ ] Task\n#tag text\n", item: [0, 1] },
	{ name: "seven hashes", content: "- [ ] Task\n####### seven\n", item: [0, 1] },
	{ name: "an equals line", content: "- [ ] Task\n===\n", item: [0, 1] },
	{ name: "a math block", content: "- [ ] Task\n$$\nx\n$$\n", item: [0, 3] },
	{ name: "HTML", content: "- [ ] Task\n<div>x</div>\n", item: [0, 1] },
	{ name: "a sub-task's lazy line", content: "- [ ] Parent\n\t- [ ] Child\nlazy\n", item: [1, 2] },
	{ name: "a sub-task's lazy line, one space", content: "- [ ] Parent\n\t- [ ] Child\n desc\n", item: [1, 2] },
	{ name: "a line ending in CRLF", content: "- [ ] Task\r\n\tdesc\r\n- [ ] Next\r\n", item: [0, 1] },
	{ name: "a one-line comment", content: "- [ ] Task\n%% c %%\n", item: [0, 1] },
	{ name: "a comment marker followed by a percent sign", content: "- [ ] Task\n%% 50% done\n", item: [0, 1] },
	{ name: "a comment block indented to the content", content: "- [ ] Task\n  %%\n  c\n  %%\n", item: [0, 3] },
	{ name: "a comment block after a blank line", content: "- [ ] Task\n\n  %%\n  c\n  %%\n", item: [0, 4] },
];

/** Lines that end the task's item. */
const NOT_COUNTED: IndexedNote[] = [
	{ name: "a heading", content: "- [ ] Task\n# H\n", item: [0, 0] },
	{ name: "a heading indented by one space", content: "- [ ] Task\n # H\n", item: [0, 0] },
	{ name: "an empty heading", content: "- [ ] Task\n#\n", item: [0, 0] },
	{ name: "a quoted heading", content: "> - [ ] Task\n> # H\n", item: [0, 0] },
	{ name: "a heading after a sub-task", content: "- [ ] Parent\n\t- [ ] Child\n# H\n", item: [1, 1] },
	{ name: "a CRLF heading", content: "- [ ] Task\r\n# H\r\n", item: [0, 0] },
	{ name: "a *** break", content: "- [ ] Task\n***\n", item: [0, 0] },
	{ name: "a --- break", content: "- [ ] Task\n---\n", item: [0, 0] },
	{ name: "a ___ break", content: "- [ ] Task\n___\n", item: [0, 0] },
	{ name: "a code fence", content: "- [ ] Task\n```\ncode\n```\n", item: [0, 0] },
	{ name: "a code fence with a language", content: "- [ ] Task\n```js\nx\n```\n", item: [0, 0] },
	{ name: "a tilde fence", content: "- [ ] Task\n~~~\nx\n~~~\n", item: [0, 0] },
	{ name: "a code fence indented by one space", content: "- [ ] Task\n ```\nx\n ```\n", item: [0, 0] },
	{ name: "a sibling task", content: "- [ ] Task\n- [ ] Next\n", item: [0, 0] },
	{ name: "another kind of list item", content: "- [ ] Task\n+ x\n", item: [0, 0] },
	{ name: "a numbered item", content: "- [ ] Task\n2. x\n", item: [0, 0] },
	{ name: "an empty list item", content: "- [ ] Task\n-\n", item: [0, 0] },
	{ name: "a paragraph after a blank line", content: "- [ ] Task\n\nplain\n", item: [0, 0] },
	{ name: "a CRLF paragraph after a blank line", content: "- [ ] Task\r\n\r\nplain\r\n", item: [0, 0] },
	{ name: "a one-space paragraph after a blank line", content: "- [ ] Task\n\n para\n", item: [0, 0] },
	{ name: "a numbered task's under-indented paragraph", content: "1. [ ] Task\n\n  two\n", item: [0, 0] },
	{ name: "a quote that a blank line ended", content: "> - [ ] Task\n\n> \tpara\n", item: [0, 0] },
	{ name: "an under-indented quoted paragraph", content: "> - [ ] Task\n>\n>  one\n", item: [0, 0] },
	{ name: "the parent's paragraph after a sub-task", content: "- [ ] Parent\n\t- [ ] Child\n\n\tmore\n", item: [1, 1] },
	{ name: "a comment block", content: "- [ ] Task\n%%\nc\n%%\n", item: [0, 0] },
	{ name: "a comment block after a sibling", content: "- [ ] Keep\n- [ ] Delete me\n%%\nhidden note\n%%\n", item: [1, 1] },
	{ name: "a comment block with text on its first line", content: "- [ ] Task\n%% open\nc\n%%\n", item: [0, 0] },
	{ name: "an unclosed comment block", content: "- [ ] Task\n%%  \n", item: [0, 0] },
	{ name: "a comment block indented by one space", content: "- [ ] Task\n %%\n", item: [0, 0] },
	{ name: "a comment block after a description", content: "- [ ] Task\n\tdesc\n%%\nc\n%%\n", item: [0, 1] },
	{ name: "a quoted comment block", content: "> - [ ] Task\n> %%\n> c\n> %%\n", item: [0, 0] },
	{ name: "a callout comment block", content: "> [!todo] Inbox\n> - [ ] Task\n> %%\n> c\n> %%\n", item: [1, 1] },
	{ name: "a tab-indented comment block after a sub-task", content: "- [ ] Parent\n\t- [ ] Child\n\t%%\n\tc\n\t%%\n", item: [1, 1] },
	{ name: "a space-indented comment block after a sub-task", content: "- [ ] Parent\n\t- [ ] Child\n  %%\n  c\n  %%\n", item: [1, 1] },
	{ name: "a numbered task's comment block", content: "1. [ ] Task\n  %%\n", item: [0, 0] },
];

describe("locateTaskBlock", () => {
	describe.each(COUNTED)("with $name in the item", ({ content, item }) => {
		it("finds the task's lines as read", () => {
			const { lines, rawText, position } = readTask(content, ...item);

			expect(locateTaskBlock(lines, rawText, position)).toEqual({
				start: item[0],
				count: item[1] - item[0] + 1,
			});
		});

		it("refuses when that line was added after the task was read", () => {
			const { lines, rawText, position } = readTask(
				content,
				item[0],
				lastLineBefore(content, item),
			);

			expect(locateTaskBlock(lines, rawText, position)).toBeUndefined();
		});
	});

	it.each(NOT_COUNTED)(
		"finds the task's lines up to $name",
		({ content, item }) => {
			const { lines, rawText, position } = readTask(content, ...item);

			expect(locateTaskBlock(lines, rawText, position)).toEqual({
				start: item[0],
				count: item[1] - item[0] + 1,
			});
		},
	);
});
