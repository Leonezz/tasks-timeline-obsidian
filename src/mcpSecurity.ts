import type { Task } from "@tasks-timeline/components";

interface SecurityRules {
	pathPrefixes: string[];
	tagPatterns: string[];
}

/**
 * Filters tasks and paths based on a user-defined blacklist.
 *
 * Blacklist format (one rule per line):
 *   path:Private/       — blocks all files under Private/
 *   tag:#secret         — blocks tasks with #secret tag
 *   tag:#confidential   — blocks tasks with #confidential tag
 *
 * Lines starting with # (without tag: prefix) or empty lines are ignored.
 */
export class SecurityManager {
	private rules: SecurityRules = { pathPrefixes: [], tagPatterns: [] };

	updateRules(blacklist: string): void {
		const pathPrefixes: string[] = [];
		const tagPatterns: string[] = [];

		const lines = blacklist.split("\n");
		for (const raw of lines) {
			const line = raw.trim();
			if (!line || line.startsWith("#")) {
				continue;
			}

			if (line.startsWith("path:")) {
				const prefix = this.normalizePath(line.slice(5).trim());
				if (prefix) {
					pathPrefixes.push(prefix);
				}
			} else if (line.startsWith("tag:")) {
				const tag = line.slice(4).trim();
				if (tag) {
					tagPatterns.push(tag.startsWith("#") ? tag : `#${tag}`);
				}
			}
			// Ignore unrecognized lines
		}

		this.rules = { pathPrefixes, tagPatterns };
	}

	/**
	 * Returns true if the file path is NOT blocked by any path prefix rule.
	 */
	isPathAllowed(filePath: string): boolean {
		const path = this.normalizePath(filePath);
		return !this.rules.pathPrefixes.some((prefix) => {
			const normalizedPrefix = this.normalizePath(prefix).replace(
				/\/+$/,
				"",
			);
			return (
				path === normalizedPrefix ||
				path.startsWith(`${normalizedPrefix}/`)
			);
		});
	}

	/**
	 * Returns true if the task is NOT blocked by any blacklist rule.
	 */
	isTaskAllowed(task: Task): boolean {
		// Check category (file path) against path rules
		if (task.category && !this.isPathAllowed(task.category)) {
			return false;
		}

		// Check tags against tag rules
		if (task.tags && this.rules.tagPatterns.length > 0) {
			const taskTagNames = task.tags.map((t) =>
				t.name.startsWith("#") ? t.name : `#${t.name}`,
			);
			for (const blockedTag of this.rules.tagPatterns) {
				if (taskTagNames.includes(blockedTag)) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * Filters an array of tasks, removing those that match blacklist rules.
	 */
	filterTasks(tasks: Task[]): Task[] {
		if (
			this.rules.pathPrefixes.length === 0 &&
			this.rules.tagPatterns.length === 0
		) {
			return tasks;
		}
		return tasks.filter((t) => this.isTaskAllowed(t));
	}

	private normalizePath(path: string): string {
		return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
	}
}
