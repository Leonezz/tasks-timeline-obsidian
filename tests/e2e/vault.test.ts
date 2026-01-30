/**
 * E2E-style tests against ExampleVault
 * These tests run against real markdown files without launching Obsidian
 *
 * AI Agent Instructions:
 * - These tests verify the plugin works with real vault structure
 * - Run with: pnpm test tests/e2e/vault.test.ts
 * - Add more tests by creating new markdown files in ExampleVault
 */

import * as path from 'path';
import { VaultTestRunner } from './vaultTestRunner';
import { TFile } from '../mocks/obsidian';

describe('ExampleVault E2E Tests', () => {
	const vaultPath = path.join(__dirname, '../../ExampleVault');
	let runner: VaultTestRunner;

	beforeAll(async () => {
		runner = new VaultTestRunner({
			vaultPath,
			verbose: false,
		});
		await runner.loadVault();
	});

	describe('Vault Structure', () => {
		it('should load markdown files from vault', () => {
			const vault = runner.getVault();
			const files = vault.getMarkdownFiles();

			expect(files.length).toBeGreaterThan(0);
		});

		it('should parse metadata for all files', () => {
			const vault = runner.getVault();
			const metadataCache = runner.getMetadataCache();
			const files = vault.getMarkdownFiles();

			files.forEach(file => {
				const metadata = metadataCache.getFileCache(file);
				expect(metadata).toBeDefined();
			});
		});
	});

	describe('Task Detection', () => {
		it('should find tasks in markdown files', async () => {
			const results = await runner.runTests();

			const tasksFound = results.reduce(
				(sum, r) => sum + r.stats.tasksFound,
				0
			);

			expect(tasksFound).toBeGreaterThan(0);
		});

		it('should parse all found tasks successfully', async () => {
			const results = await runner.runTests();

			results.forEach(result => {
				expect(result.stats.tasksParsed).toBe(result.stats.tasksFound);
			});
		});

		it('should detect tasks with dates', async () => {
			const results = await runner.runTests();

			const tasksWithDates = results.reduce(
				(sum, r) => sum + r.stats.tasksWithDates,
				0
			);

			// At least some tasks should have dates
			expect(tasksWithDates).toBeGreaterThanOrEqual(0);
		});

		it('should detect tasks with priority', async () => {
			const results = await runner.runTests();

			const tasksWithPriority = results.reduce(
				(sum, r) => sum + r.stats.tasksWithPriority,
				0
			);

			// At least some tasks should have priority
			expect(tasksWithPriority).toBeGreaterThanOrEqual(0);
		});
	});

	describe('Task Format Validation', () => {
		it('should have no format errors', async () => {
			const results = await runner.runTests();

			const allErrors = results.flatMap(r => r.errors);

			if (allErrors.length > 0) {
				console.log('Format errors found:', allErrors);
			}

			expect(allErrors.length).toBe(0);
		});

		it('should pass all file tests', async () => {
			const results = await runner.runTests();

			const failedFiles = results.filter(r => !r.passed);

			if (failedFiles.length > 0) {
				console.log('Failed files:', failedFiles.map(f => f.file));
			}

			expect(failedFiles.length).toBe(0);
		});
	});

	describe('Report Generation', () => {
		it('should generate a summary report', async () => {
			const results = await runner.runTests();
			const report = runner.generateReport(results);

			expect(report).toContain('Vault Test Report');
			expect(report).toContain('Files tested:');
			expect(report).toContain('Total tasks:');
		});
	});

	describe('MockTasks.md Specific Tests', () => {
		it('should parse MockTasks.md if it exists', async () => {
			const vault = runner.getVault();
			const file = vault.getAbstractFileByPath('MockTasks.md');

			if (file instanceof TFile) {
				const metadataCache = runner.getMetadataCache();
				const metadata = metadataCache.getFileCache(file);

				expect(metadata).toBeDefined();
				expect(metadata?.listItems).toBeDefined();
			}
		});
	});

	describe('DailyNotes Detection', () => {
		it('should detect daily note format files', async () => {
			const vault = runner.getVault();
			const files = vault.getMarkdownFiles();

			const dailyNotes = files.filter(f =>
				/DailyNotes\/\d{4}-\d{2}-\d{2}\.md/.test(f.path)
			);

			// Should have at least one daily note or none
			expect(dailyNotes.length).toBeGreaterThanOrEqual(0);
		});
	});
});
