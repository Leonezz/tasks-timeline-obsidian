/**
 * Unit tests for task serializers
 * Tests conversion of Task objects back to markdown format
 */

import { Task } from '@tasks-timeline/components';
import { taskToMarkdown } from '../../src/serializers';

describe('taskToMarkdown', () => {
	describe('Status Updates', () => {
		it('should update status from todo to done', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'done',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [x] Test task');
		});

		it('should update status from done to todo', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [x] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Test task');
		});

		it('should update status to cancelled', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'cancelled',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [-] Test task');
		});

		it('should update status to doing', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'doing',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [/] Test task');
		});
	});

	describe('Title Updates', () => {
		it('should update task title', () => {
			const task: Task = {
				id: '1',
				title: 'Updated title',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [ ] Original title';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Updated title');
		});

		it('should preserve indentation when updating title', () => {
			const task: Task = {
				id: '1',
				title: 'Updated title',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '  - [ ] Original title';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('  - [ ] Updated title');
		});

		it('should handle titles with special characters', () => {
			const task: Task = {
				id: '1',
				title: 'Task with "quotes" and \'apostrophes\'',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [ ] Original title';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toContain('Task with "quotes" and \'apostrophes\'');
		});
	});

	describe('Tags', () => {
		it('should append tags to task', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [
					{ id: '#work', name: '#work' },
					{ id: '#urgent', name: '#urgent' },
				],
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Test task #work #urgent');
		});

		it('should not duplicate tags that came from frontmatter', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [{ id: '#project', name: '#project' }],
				extra: {
					frontmatterTags: JSON.stringify(['#project']),
				},
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			// Should not add #project since it's from frontmatter and not inline
			expect(result).toBe('- [ ] Test task');
		});

		it('should preserve inline tags even if they are in frontmatter', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [{ id: '#project', name: '#project' }],
				extra: {
					frontmatterTags: JSON.stringify(['#project']),
				},
			};
			const originalLine = '- [ ] Test task #project';
			const result = taskToMarkdown(task, originalLine);

			// Should keep #project since it was inline in original
			expect(result).toBe('- [ ] Test task #project');
		});
	});

	describe('Priority', () => {
		it('should add high priority symbol', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'high',
				tags: [],
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			// Should contain one of the high priority symbols (first match is used)
			expect(result).toMatch(/🔺|⏫/);
		});

		it('should add low priority symbol', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'low',
				tags: [],
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toContain('🔽');
		});

		it('should not add symbol for medium priority', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Test task');
		});
	});

	describe('Dates', () => {
		it('should add due date', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
				dueAt: '2024-01-15',
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Test task 📅 2024-01-15');
		});

		it('should add start date', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
				startAt: '2024-01-10',
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Test task 🛫 2024-01-10');
		});

		it('should add completed date', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'done',
				category: 'test',
				priority: 'medium',
				tags: [],
				completedAt: '2024-01-20',
			};
			const originalLine = '- [x] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [x] Test task ✅ 2024-01-20');
		});

		it('should add multiple dates', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'done',
				category: 'test',
				priority: 'medium',
				tags: [],
				startAt: '2024-01-10',
				dueAt: '2024-01-15',
				completedAt: '2024-01-20',
			};
			const originalLine = '- [x] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toContain('📅 2024-01-15');
			expect(result).toContain('🛫 2024-01-10');
			expect(result).toContain('✅ 2024-01-20');
		});
	});

	describe('Recurrence', () => {
		it('should add recurrence interval', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
				recurringInterval: 'every week',
			};
			const originalLine = '- [ ] Test task';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Test task 🔁 every week');
		});
	});

	describe('Block Links', () => {
		it('should preserve block links', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'todo',
				category: 'test',
				priority: 'medium',
				tags: [],
			};
			const originalLine = '- [ ] Test task ^abc123';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toBe('- [ ] Test task ^abc123');
		});

		it('should preserve block links with other metadata', () => {
			const task: Task = {
				id: '1',
				title: 'Test task',
				status: 'done',
				category: 'test',
				priority: 'high',
				tags: [],
				dueAt: '2024-01-15',
			};
			const originalLine = '- [ ] Test task ^abc123';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toContain('^abc123');
			expect(result).toMatch(/🔺|⏫/);
			expect(result).toContain('📅 2024-01-15');
		});
	});

	describe('Complex Tasks', () => {
		it('should handle task with all features', () => {
			const task: Task = {
				id: '1',
				title: 'Complex task',
				status: 'done',
				category: 'test',
				priority: 'high',
				tags: [{ id: '#project', name: '#project' }],
				dueAt: '2024-01-15',
				startAt: '2024-01-10',
				completedAt: '2024-01-14',
				recurringInterval: 'every week',
			};
			const originalLine = '  - [ ] Complex task ^block';
			const result = taskToMarkdown(task, originalLine);

			expect(result).toContain('  - [x]'); // Indentation + done status
			expect(result).toContain('Complex task');
			expect(result).toContain('#project');
			expect(result).toMatch(/🔺|⏫/);
			expect(result).toContain('📅 2024-01-15');
			expect(result).toContain('🛫 2024-01-10');
			expect(result).toContain('✅ 2024-01-14');
			expect(result).toContain('🔁 every week');
			expect(result).toContain('^block');
		});
	});
});
