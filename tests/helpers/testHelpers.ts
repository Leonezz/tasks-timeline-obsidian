/**
 * Test helper utilities for AI-friendly testing
 * These utilities make it easy to set up test scenarios
 */

import { TFile, Vault, MetadataCache, App, CachedMetadata, type ListItemCache } from '../mocks/obsidian';

/**
 * Creates a test vault with files and content
 */
export class TestVault {
	vault: Vault;
	metadataCache: MetadataCache;
	app: App;

	constructor() {
		this.app = new App();
		this.vault = this.app.vault;
		this.metadataCache = this.app.metadataCache;
	}

	/**
	 * Add a markdown file to the vault
	 */
	addFile(path: string, content: string, metadata?: CachedMetadata) {
		this.vault._addFile(path, content);
		if (metadata) {
			this.metadataCache._setCache(path, metadata);
		}
		return this;
	}

	/**
	 * Get a file from the vault
	 */
	getFile(path: string): TFile | null {
		return this.vault.getAbstractFileByPath(path) as TFile | null;
	}

	/**
	 * Read file content
	 */
	async readFile(path: string): Promise<string> {
		const file = this.getFile(path);
		if (!file) throw new Error(`File not found: ${path}`);
		return this.vault.cachedRead(file);
	}

	/**
	 * Update file content
	 */
	async updateFile(path: string, content: string) {
		const file = this.getFile(path);
		if (!file) throw new Error(`File not found: ${path}`);
		await this.vault.modify(file, content);
	}
}

/**
 * Parse a simple task line into structured data for testing
 */
export function parseTaskLine(line: string, lineNumber: number = 0) {
	const taskRegex = /^(\s*)[-*+]\s+\[(.)\]\s+(.+)$/;
	const match = line.match(taskRegex);

	if (!match) {
		return null;
	}

	const [, indent, marker, content] = match;
	const startCol = indent?.length || 0;
	const startOffset = lineNumber * 50; // Approximate
	const endOffset = startOffset + line.length;

	return {
		indent,
		marker,
		content: content?.trim(),
		position: {
			start: { line: lineNumber, col: startCol, offset: startOffset },
			end: { line: lineNumber, col: line.length, offset: endOffset },
		},
	};
}

/**
 * Create metadata for a file with tasks
 */
export function createTaskMetadata(taskLines: string[]): CachedMetadata {
	const listItems = taskLines
		.map((line, idx) => parseTaskLine(line, idx))
		.filter(Boolean)
		.map((parsed) => ({
			position: parsed!.position,
			parent: -1,
			task: parsed!.marker,
		}));

	return {
		listItems,
		sections: [],
		links: [],
		tags: [],
	};
}

/**
 * Assert that a task matches expected values
 */
export function assertTaskMatches(task: any, expected: Partial<any>) {
	if (expected.title !== undefined) {
		expect(task.title).toBe(expected.title);
	}
	if (expected.status !== undefined) {
		expect(task.status).toBe(expected.status);
	}
	if (expected.priority !== undefined) {
		expect(task.priority).toBe(expected.priority);
	}
	if (expected.tags !== undefined) {
		expect(task.tags).toEqual(expected.tags);
	}
}

/**
 * Wait for async operations to complete
 */
export async function waitFor(ms: number = 100) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates a mock plugin instance for testing
 */
export function createMockPlugin() {
	const app = new App();
	return {
		app,
		settings: {
			taskStatusMapping: {},
		},
		loadData: jest.fn().mockResolvedValue({}),
		saveData: jest.fn().mockResolvedValue(undefined),
	};
}

/**
 * Extracts all task lines from markdown content
 */
export function extractTaskLines(content: string): string[] {
	return content
		.split('\n')
		.filter(line => /^\s*[-*+]\s+\[.\]/.test(line));
}

/**
 * Count tasks by status in content
 */
export function countTasksByStatus(content: string): { open: number; completed: number; total: number } {
	const taskLines = extractTaskLines(content);
	const completed = taskLines.filter(line => /\[x\]/i.test(line)).length;
	const open = taskLines.filter(line => /\[ \]/.test(line)).length;

	return {
		open,
		completed,
		total: taskLines.length,
	};
}

/**
 * Generates a daily note filename for a given date
 */
export function getDailyNoteFilename(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}.md`;
}

/**
 * Create a realistic test scenario with multiple files
 */
export function createTestScenario(name: 'basic' | 'complex' | 'edge-cases'): TestVault {
	const vault = new TestVault();

	switch (name) {
		case 'basic':
			vault.addFile(
				'tasks.md',
				'- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3',
				createTaskMetadata([
					'- [ ] Task 1',
					'- [x] Task 2',
					'- [ ] Task 3',
				])
			);
			break;

		case 'complex':
			vault.addFile(
				'project.md',
				'# Project\n- [ ] Setup 📅 2024-01-15\n- [ ] Development [due:: 2024-01-20]',
				createTaskMetadata([
					'- [ ] Setup 📅 2024-01-15',
					'- [ ] Development [due:: 2024-01-20]',
				])
			);
			vault.addFile(
				'daily/2024-01-15.md',
				'# Daily Note\n- [ ] Morning standup\n- [x] Review PRs',
				createTaskMetadata([
					'- [ ] Morning standup',
					'- [x] Review PRs',
				])
			);
			break;

		case 'edge-cases':
			vault.addFile(
				'empty.md',
				'',
				{ listItems: [] }
			);
			vault.addFile(
				'no-tasks.md',
				'# Document\nJust text, no tasks.',
				{ listItems: [] }
			);
			vault.addFile(
				'special.md',
				'- [ ] Task with "quotes"\n- [ ] Task with emoji 🚀',
				createTaskMetadata([
					'- [ ] Task with "quotes"',
					'- [ ] Task with emoji 🚀',
				])
			);
			break;
	}

	return vault;
}

/**
 * Builds Obsidian-like list item metadata for every top-level task line.
 */
export function createListItems(content: string): ListItemCache[] {
	let offset = 0;
	return content.split("\n").flatMap((line, lineNumber) => {
		const startOffset = offset;
		offset += line.length + 1;

		if (!/^- \[[^\]]\] /.test(line)) {
			return [];
		}

		return [
			{
				position: {
					start: { line: lineNumber, col: 0, offset: startOffset },
					end: {
						line: lineNumber,
						col: line.length,
						offset: startOffset + line.length,
					},
				},
				parent: -1,
				task: line.slice(3, 4),
			},
		];
	});
}

/**
 * Sets a file's metadata from its content, like Obsidian's indexer does.
 */
export function indexFile(app: App, path: string, content: string) {
	app.metadataCache._setCache(path, {
		listItems: createListItems(content),
		sections: [],
		links: [],
		tags: [],
	});
}

/**
 * Rewrites a file the way an edit outside the plugin does (the editor, or the
 * Tasks plugin completing a recurring task): the write fires vault "modify",
 * then Obsidian re-indexes the file and fires metadataCache "changed".
 */
export async function editExternally(app: App, path: string, content: string) {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) throw new Error(`File not found: ${path}`);
	await app.vault.modify(file, content);
	indexFile(app, path, content);
	app.metadataCache.trigger("changed", file);
}

/**
 * Makes `vault.process` re-index the written file asynchronously and fire
 * metadataCache "changed", mimicking Obsidian's indexing after a write.
 */
export function reindexAfterWrites(app: App) {
	const originalProcess = app.vault.process.bind(app.vault);
	return jest
		.spyOn(app.vault, "process")
		.mockImplementation(async (file, fn) => {
			await originalProcess(file, fn);
			const content = await app.vault.read(file);
			setTimeout(() => {
				indexFile(app, file.path, content);
				app.metadataCache.trigger("changed", file);
			}, 0);
		});
}
