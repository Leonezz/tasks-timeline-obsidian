/**
 * Sample task markdown content for testing
 * These are realistic examples from different task formats
 */

export const SAMPLE_TASKS = {
	// Basic task formats
	simple: '- [ ] Simple task',
	completed: '- [x] Completed task',
	withSpaces: '  - [ ] Indented task',

	// Tasks Plugin format with emojis
	withDueDate: '- [ ] Task with due date 📅 2024-01-15',
	withScheduledDate: '- [ ] Task with scheduled date ⏳ 2024-01-10',
	withStartDate: '- [ ] Task with start date 🛫 2024-01-05',
	withDoneDate: '- [x] Completed task ✅ 2024-01-20',
	withPriority: '- [ ] High priority task ⏫',
	withRecurrence: '- [ ] Recurring task 🔁 every week',

	// Dataview format
	withDataviewDate: '- [ ] Task [due:: 2024-01-15]',
	withDataviewPriority: '- [ ] Task [priority:: high]',
	multipleDataview: '- [ ] Complex task [due:: 2024-01-15] [priority:: high] [category:: work]',

	// Combined formats
	combined: '- [ ] Complex task 📅 2024-01-15 ⏫ [category:: work] #project',

	// With tags and links
	withTags: '- [ ] Task with #tag1 and #tag2',
	withLinks: '- [ ] Task with [[note link]] and more',
	withBlockLink: '- [ ] Task with content ^abc123',

	// Edge cases
	empty: '- [ ] ',
	onlyWhitespace: '- [ ]   ',
	multiline: '- [ ] First line\n  Second line',
	specialChars: '- [ ] Task with "quotes" and \'apostrophes\'',
	unicode: '- [ ] Task with emoji 🚀 and unicode 中文',

	// Non-task items
	notTask: '- Regular list item',
	checklist: '- [ ] Not a task (no marker)',
	heading: '## Not a task',
	paragraph: 'Just a paragraph',
};

export const SAMPLE_FILES = {
	basicTasks: `# My Tasks

- [ ] First task
- [x] Completed task
- [ ] Third task

## Work Tasks

- [ ] Work item 1 #work
- [ ] Work item 2 #work 📅 2024-01-20
`,

	dataviewTasks: `# Project Tasks

- [ ] Setup project [due:: 2024-01-15] [priority:: high]
- [ ] Write documentation [due:: 2024-01-20]
- [x] Initial research [done:: 2024-01-05]
`,

	dailyNote: `# 2024-01-15

- [ ] Morning standup
- [ ] Review PRs
- [x] Lunch meeting

## Notes

Some notes here.
`,

	mixedFormat: `# Mixed Tasks

- [ ] Task with emoji due date 📅 2024-01-15
- [ ] Task with dataview [due:: 2024-01-20]
- [ ] Task with both 📅 2024-01-25 [priority:: high]
- [x] Completed with done date ✅ 2024-01-10
`,

	nestedTasks: `# Nested Structure

## Parent Section

- [ ] Parent task
	- [ ] Child task 1
	- [ ] Child task 2
- [ ] Another parent
	- [ ] Nested child

### Subsection

- [ ] Subsection task
`,

	emptyFile: '',

	noTasks: `# Document Without Tasks

This is a regular document.

## Section

Just some content here, no tasks.
`,
};

export const SAMPLE_METADATA = {
	basicListItem: {
		position: {
			start: { line: 2, col: 0, offset: 12 },
			end: { line: 2, col: 17, offset: 29 },
		},
		parent: -1,
		task: ' ',
	},

	completedListItem: {
		position: {
			start: { line: 3, col: 0, offset: 30 },
			end: { line: 3, col: 21, offset: 51 },
		},
		parent: -1,
		task: 'x',
	},

	headingSection: {
		type: 'heading',
		position: {
			start: { line: 0, col: 0, offset: 0 },
			end: { line: 0, col: 10, offset: 10 },
		},
	},

	frontmatterWithTags: {
		tags: ['project', 'urgent'],
		category: 'work',
	},

	linkCache: {
		link: 'other-note',
		original: '[[other-note]]',
		position: {
			start: { line: 2, col: 10, offset: 22 },
			end: { line: 2, col: 24, offset: 36 },
		},
	},

	tagCache: {
		tag: '#work',
		position: {
			start: { line: 2, col: 30, offset: 42 },
			end: { line: 2, col: 35, offset: 47 },
		},
	},
};

/**
 * Creates a mock TFile with realistic path
 */
export function createMockFile(name: string, content: string = '') {
	return {
		path: `vault/${name}`,
		name,
		basename: name.replace(/\.md$/, ''),
		extension: 'md',
		content,
	};
}

/**
 * Creates a position object for a line in a file
 */
export function createPosition(
	startLine: number,
	startCol: number,
	endLine: number,
	endCol: number,
	startOffset: number,
	endOffset: number
) {
	return {
		start: { line: startLine, col: startCol, offset: startOffset },
		end: { line: endLine, col: endCol, offset: endOffset },
	};
}
