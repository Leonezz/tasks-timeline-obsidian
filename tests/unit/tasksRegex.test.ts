/**
 * Unit tests for task regular expressions
 * Tests pattern matching for various task formats
 */

import { TaskRegularExpressions } from '../../src/tasksRegex';

describe('TaskRegularExpressions', () => {
	describe('taskRegex', () => {
		it('should match basic task', () => {
			const line = '- [ ] Simple task';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).not.toBeNull();
			expect(match![3]).toBe(' '); // status marker
			expect(match![4]).toBe('Simple task'); // body
		});

		it('should match completed task', () => {
			const line = '- [x] Completed task';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).not.toBeNull();
			expect(match![3]).toBe('x');
		});

		it('should match indented task', () => {
			const line = '  - [ ] Indented task';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('  '); // indentation
			expect(match![4]).toBe('Indented task');
		});

		it('should match task with * list marker', () => {
			const line = '* [ ] Task with star';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).not.toBeNull();
			expect(match![2]).toBe('*'); // list marker
		});

		it('should not match task with + list marker (not supported)', () => {
			const line = '+ [ ] Task with plus';
			const match = line.match(TaskRegularExpressions.taskRegex);

			// + is not supported, only - and * are valid list markers
			expect(match).toBeNull();
		});

		it('should match task with cancelled status', () => {
			const line = '- [-] Cancelled task';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).not.toBeNull();
			expect(match![3]).toBe('-');
		});

		it('should match task with in-progress status', () => {
			const line = '- [/] In progress task';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).not.toBeNull();
			expect(match![3]).toBe('/');
		});

		it('should not match regular list item', () => {
			const line = '- Regular list item';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).toBeNull();
		});

		it('should not match heading', () => {
			const line = '## Heading';
			const match = line.match(TaskRegularExpressions.taskRegex);

			expect(match).toBeNull();
		});
	});

	describe('checkboxRegex', () => {
		it('should match empty checkbox', () => {
			const line = '- [ ] Task';
			const match = line.match(TaskRegularExpressions.checkboxRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe(' ');
		});

		it('should match completed checkbox', () => {
			const line = '- [x] Task';
			const match = line.match(TaskRegularExpressions.checkboxRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('x');
		});

		it('should match any single character in checkbox', () => {
			const line = '- [?] Task';
			const match = line.match(TaskRegularExpressions.checkboxRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('?');
		});
	});

	describe('dueDateRegex', () => {
		it('should match due date with emoji', () => {
			const text = 'Task 📅 2024-01-15';
			const match = text.match(TaskRegularExpressions.dueDateRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('2024-01-15');
		});

		it('should not match without emoji', () => {
			const text = 'Task 2024-01-15';
			const match = text.match(TaskRegularExpressions.dueDateRegex);

			expect(match).toBeNull();
		});
	});

	describe('scheduledDateRegex', () => {
		it('should match scheduled date with emoji', () => {
			const text = 'Task ⏳ 2024-01-10';
			const match = text.match(TaskRegularExpressions.scheduledDateRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('2024-01-10');
		});
	});

	describe('startDateRegex', () => {
		it('should match start date with emoji', () => {
			const text = 'Task 🛫 2024-01-05';
			const match = text.match(TaskRegularExpressions.startDateRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('2024-01-05');
		});
	});

	describe('doneDateRegex', () => {
		it('should match done date with emoji', () => {
			const text = 'Task ✅ 2024-01-20';
			const match = text.match(TaskRegularExpressions.doneDateRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('2024-01-20');
		});
	});

	describe('priorityRegex', () => {
		it('should match high priority', () => {
			const text = 'Task ⏫';
			const match = text.match(TaskRegularExpressions.priorityRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('⏫');
		});

		it('should match medium-high priority', () => {
			const text = 'Task 🔼';
			const match = text.match(TaskRegularExpressions.priorityRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('🔼');
		});

		it('should match low priority', () => {
			const text = 'Task 🔽';
			const match = text.match(TaskRegularExpressions.priorityRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('🔽');
		});
	});

	describe('recurrenceRegex', () => {
		it('should match recurrence rule', () => {
			const text = 'Task 🔁 every week';
			const match = text.match(TaskRegularExpressions.recurrenceRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toBe('every week');
		});

		it('should match complex recurrence', () => {
			const text = 'Task 🔁 every 2 weeks on Monday';
			const match = text.match(TaskRegularExpressions.recurrenceRegex);

			expect(match).not.toBeNull();
			expect(match![1]).toContain('every 2 weeks');
		});
	});

	describe('blockLinkRegex', () => {
		it('should match block link', () => {
			const text = 'Task content ^abc123';
			const match = text.match(TaskRegularExpressions.blockLinkRegex);

			expect(match).not.toBeNull();
			// Block link regex includes leading space
			expect(match![0]).toBe(' ^abc123');
		});

		it('should match block link with alphanumeric', () => {
			const text = 'Task ^block-id-123';
			const match = text.match(TaskRegularExpressions.blockLinkRegex);

			expect(match).not.toBeNull();
			expect(match![0]).toContain('^block-id-123');
		});
	});

	describe('keyValueRegex (dataview fields)', () => {
		it('should match dataview field', () => {
			const text = 'Task [[due:: 2024-01-15]]';
			const match = text.match(TaskRegularExpressions.keyValueRegex);

			expect(match).not.toBeNull();
		});

		it('should match multiple dataview fields', () => {
			const text = 'Task [[due:: 2024-01-15]] [[priority:: high]]';
			const matches = text.matchAll(TaskRegularExpressions.keyValueRegex);
			const matchArray = Array.from(matches);

			expect(matchArray.length).toBe(2);
		});
	});

	describe('hashTags regex', () => {
		it('should match hashtag', () => {
			const text = 'Task with #tag';
			const match = text.match(TaskRegularExpressions.hashTags);

			expect(match).not.toBeNull();
			// Regex includes leading space or start-of-string
			expect(match![0].trim()).toBe('#tag');
		});

		it('should match multiple hashtags', () => {
			const text = 'Task with #tag1 and #tag2';
			const matches = text.matchAll(TaskRegularExpressions.hashTags);
			const matchArray = Array.from(matches);

			expect(matchArray.length).toBe(2);
		});

		it('should match nested tags', () => {
			const text = 'Task with #project/subtask';
			const match = text.match(TaskRegularExpressions.hashTags);

			expect(match).not.toBeNull();
			expect(match![0].trim()).toContain('#project/subtask');
		});
	});
});
