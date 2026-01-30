/**
 * E2E-style test runner that tests against real vault structure
 * This simulates Obsidian's behavior without launching the actual app
 *
 * AI Agent Usage:
 * 1. Point the runner at ExampleVault directory
 * 2. Run tests against real markdown files
 * 3. Verify parsing, serialization, and task operations
 * 4. Can be used in CI/CD without Obsidian installed
 */

import * as fs from 'fs';
import * as path from 'path';
import { TFile, Vault, MetadataCache, CachedMetadata, ListItemCache, Pos } from '../mocks/obsidian';

export interface VaultTestConfig {
	vaultPath: string;
	excludePaths?: string[];
	verbose?: boolean;
}

export interface TestResult {
	file: string;
	passed: boolean;
	errors: string[];
	warnings: string[];
	stats: {
		tasksFound: number;
		tasksParsed: number;
		tasksWithDates: number;
		tasksWithPriority: number;
	};
}

/**
 * Scans a real vault directory and creates a test environment
 */
export class VaultTestRunner {
	private config: VaultTestConfig;
	private vault: Vault;
	private metadataCache: MetadataCache;

	constructor(config: VaultTestConfig) {
		this.config = {
			excludePaths: ['.obsidian', 'node_modules', '.git'],
			verbose: false,
			...config,
		};
		this.vault = new Vault();
		this.metadataCache = new MetadataCache();
	}

	/**
	 * Load all markdown files from the vault
	 */
	async loadVault(): Promise<void> {
		const files = this.findMarkdownFiles(this.config.vaultPath);

		for (const filePath of files) {
			const content = fs.readFileSync(filePath, 'utf-8');
			const relativePath = path.relative(this.config.vaultPath, filePath);

			// Add to mock vault
			this.vault._addFile(relativePath, content);

			// Parse metadata
			const metadata = this.parseMetadata(content);
			this.metadataCache._setCache(relativePath, metadata);

			if (this.config.verbose) {
				console.log(`Loaded: ${relativePath} (${metadata.listItems?.length || 0} tasks)`);
			}
		}
	}

	/**
	 * Find all markdown files recursively
	 */
	private findMarkdownFiles(dir: string): string[] {
		const files: string[] = [];
		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			// Skip excluded paths
			if (this.config.excludePaths?.some(excluded => entry.name.includes(excluded))) {
				continue;
			}

			if (entry.isDirectory()) {
				files.push(...this.findMarkdownFiles(fullPath));
			} else if (entry.isFile() && entry.name.endsWith('.md')) {
				files.push(fullPath);
			}
		}

		return files;
	}

	/**
	 * Parse metadata from markdown content
	 * This is a simplified version of Obsidian's metadata cache
	 */
	private parseMetadata(content: string): CachedMetadata {
		const lines = content.split('\n');
		const listItems: ListItemCache[] = [];
		let offset = 0;

		lines.forEach((line, lineNumber) => {
			// Check if line is a task
			const taskMatch = line.match(/^(\s*)[-*+]\s+\[(.)\]\s+(.*)$/);
			if (taskMatch) {
				const [, indent, marker] = taskMatch;
				const startCol = indent?.length || 0;
				const position: Pos = {
					start: { line: lineNumber, col: startCol, offset },
					end: { line: lineNumber, col: line.length, offset: offset + line.length },
				};

				listItems.push({
					position,
					parent: -1,
					task: marker,
				});
			}

			offset += line.length + 1; // +1 for newline
		});

		return {
			listItems,
			sections: [],
			links: [],
			tags: [],
		};
	}

	/**
	 * Run tests on all loaded files
	 */
	async runTests(): Promise<TestResult[]> {
		await this.loadVault();

		const files = this.vault.getMarkdownFiles();
		const results: TestResult[] = [];

		for (const file of files) {
			const result = await this.testFile(file);
			results.push(result);

			if (this.config.verbose) {
				this.printResult(result);
			}
		}

		return results;
	}

	/**
	 * Test a single file
	 */
	private async testFile(file: TFile): Promise<TestResult> {
		const result: TestResult = {
			file: file.path,
			passed: true,
			errors: [],
			warnings: [],
			stats: {
				tasksFound: 0,
				tasksParsed: 0,
				tasksWithDates: 0,
				tasksWithPriority: 0,
			},
		};

		try {
			const content = await this.vault.cachedRead(file);
			const metadata = this.metadataCache.getFileCache(file);

			if (!metadata) {
				result.warnings.push('No metadata found');
				return result;
			}

			result.stats.tasksFound = metadata.listItems?.length || 0;

			// Test each task line
			const lines = content.split('\n');
			metadata.listItems?.forEach((item) => {
				const line = lines[item.position.start.line];
				if (!line) {
					result.errors.push(`Line ${item.position.start.line} not found`);
					result.passed = false;
					return;
				}

				// Verify task format
				if (!this.isValidTaskLine(line)) {
					result.errors.push(`Invalid task format at line ${item.position.start.line}: ${line}`);
					result.passed = false;
					return;
				}

				result.stats.tasksParsed++;

				// Check for dates
				if (this.hasDate(line)) {
					result.stats.tasksWithDates++;
				}

				// Check for priority
				if (this.hasPriority(line)) {
					result.stats.tasksWithPriority++;
				}
			});
		} catch (error) {
			result.errors.push(`Error testing file: ${error}`);
			result.passed = false;
		}

		return result;
	}

	/**
	 * Validate task line format
	 */
	private isValidTaskLine(line: string): boolean {
		return /^\s*[-*+]\s+\[.\]\s+\S/.test(line);
	}

	/**
	 * Check if line contains date
	 */
	private hasDate(line: string): boolean {
		return /📅|⏳|🛫|✅|\[due::|start::|scheduled::|done::/.test(line);
	}

	/**
	 * Check if line contains priority
	 */
	private hasPriority(line: string): boolean {
		return /⏫|🔼|🔽|\[priority::/.test(line);
	}

	/**
	 * Print test result
	 */
	private printResult(result: TestResult): void {
		const status = result.passed ? '✓' : '✗';
		console.log(`\n${status} ${result.file}`);
		console.log(`  Tasks: ${result.stats.tasksParsed}/${result.stats.tasksFound}`);

		if (result.stats.tasksWithDates > 0) {
			console.log(`  With dates: ${result.stats.tasksWithDates}`);
		}

		if (result.stats.tasksWithPriority > 0) {
			console.log(`  With priority: ${result.stats.tasksWithPriority}`);
		}

		if (result.errors.length > 0) {
			console.log('  Errors:');
			result.errors.forEach(err => console.log(`    - ${err}`));
		}

		if (result.warnings.length > 0) {
			console.log('  Warnings:');
			result.warnings.forEach(warn => console.log(`    - ${warn}`));
		}
	}

	/**
	 * Generate summary report
	 */
	generateReport(results: TestResult[]): string {
		const passed = results.filter(r => r.passed).length;
		const failed = results.length - passed;
		const totalTasks = results.reduce((sum, r) => sum + r.stats.tasksParsed, 0);

		let report = '\n=== Vault Test Report ===\n\n';
		report += `Files tested: ${results.length}\n`;
		report += `Passed: ${passed}\n`;
		report += `Failed: ${failed}\n`;
		report += `Total tasks: ${totalTasks}\n\n`;

		if (failed > 0) {
			report += 'Failed files:\n';
			results
				.filter(r => !r.passed)
				.forEach(r => {
					report += `  - ${r.file}\n`;
					r.errors.forEach(err => report += `    ${err}\n`);
				});
		}

		return report;
	}

	/**
	 * Get vault instance for custom tests
	 */
	getVault(): Vault {
		return this.vault;
	}

	/**
	 * Get metadata cache for custom tests
	 */
	getMetadataCache(): MetadataCache {
		return this.metadataCache;
	}
}

/**
 * Helper function to run vault tests from a test file
 */
export async function testVault(vaultPath: string, verbose: boolean = false): Promise<TestResult[]> {
	const runner = new VaultTestRunner({ vaultPath, verbose });
	const results = await runner.runTests();
	const report = runner.generateReport(results);

	if (verbose) {
		console.log(report);
	}

	return results;
}
