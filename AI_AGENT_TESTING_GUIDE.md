# AI Agent Testing Guide

## Overview

This project now has a comprehensive testing framework designed specifically for AI agents. The testing approach is pragmatic, focusing on what works without requiring Obsidian to be running.

## Quick Start

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:unit      # Fast unit tests (< 1 second)
pnpm test:e2e       # E2E-style vault tests
pnpm test:vault     # Verbose vault validation

# Development workflow
pnpm test:watch     # Watch mode for TDD
pnpm test:coverage  # Generate coverage report
```

## Test Architecture

### Three-Layer Approach

```
┌─────────────────────────────────────────┐
│ Layer 1: Unit Tests (tests/unit/)      │
│ - Pure logic, no mocking               │
│ - Serializers, parsers, regex          │
│ - Fast: < 1 second                     │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│ Layer 2: E2E-Style (tests/e2e/)        │
│ - Tests against real vault files       │
│ - Simulates Obsidian without running it│
│ - Validates task parsing & format      │
└─────────────────────────────────────────┘
           ↓
┌─────────────────────────────────────────┐
│ Layer 3: CI/CD (.github/workflows/)    │
│ - Automated runs on PR/push            │
│ - Multi-node version testing           │
│ - Coverage reporting                   │
└─────────────────────────────────────────┘
```

## What's Tested

### Unit Tests (50 tests, all passing ✓)

**serializers.test.ts** - Task serialization to markdown
- Status updates (todo, done, cancelled, doing)
- Title updates with special characters
- Tag handling (inline vs frontmatter)
- Priority symbols
- Date fields (due, start, completed)
- Recurrence rules
- Block link preservation
- Complex tasks with all features

**tasksRegex.test.ts** - Regular expression patterns
- Task line matching (-, * markers)
- Checkbox patterns
- Date formats (📅, ⏳, 🛫, ✅)
- Priority symbols (🔺, 🔼, 🔽)
- Recurrence patterns
- Block links
- Dataview fields [[key:: value]]
- Hashtags

### E2E Vault Tests (11 tests, all passing ✓)

**vault.test.ts** - Real vault validation
- Loads markdown files from ExampleVault/
- Parses metadata for all files
- Detects and validates task format
- Identifies tasks with dates/priority
- Generates validation reports
- Tests daily notes structure

## Test Utilities for AI Agents

### 1. Mock Obsidian APIs (`tests/mocks/obsidian.ts`)

Complete mock implementation of Obsidian classes:
- `TFile`, `TFolder`, `Vault`
- `MetadataCache` with task metadata
- `Plugin`, `App`, `Workspace`
- `Notice` for user feedback

**Usage:**
```typescript
import { Vault, TFile, MetadataCache } from '../mocks/obsidian';

const vault = new Vault();
vault._addFile('test.md', '- [ ] My task');
```

### 2. Test Fixtures (`tests/fixtures/sampleTasks.ts`)

Predefined task formats and file contents:

```typescript
import { SAMPLE_TASKS, SAMPLE_FILES } from './fixtures/sampleTasks';

// Use realistic task formats
SAMPLE_TASKS.withDueDate       // '- [ ] Task 📅 2024-01-15'
SAMPLE_TASKS.withPriority      // '- [ ] Task ⏫'
SAMPLE_TASKS.combined          // '- [ ] Task 📅 2024-01-15 ⏫ #tag'

// Use complete file examples
SAMPLE_FILES.basicTasks
SAMPLE_FILES.dataviewTasks
SAMPLE_FILES.dailyNote
```

### 3. Test Helpers (`tests/helpers/testHelpers.ts`)

Utility functions for test setup:

```typescript
import { TestVault, createTestScenario } from './helpers/testHelpers';

// Create a test vault
const vault = new TestVault();
vault.addFile('tasks.md', '- [ ] Task', metadata);

// Or use predefined scenarios
const vault = createTestScenario('basic');    // Simple tasks
const vault = createTestScenario('complex');  // Complex formats
const vault = createTestScenario('edge-cases'); // Edge cases
```

### 4. Vault Test Runner (`tests/e2e/vaultTestRunner.ts`)

Test against real vault directories:

```typescript
import { VaultTestRunner } from './e2e/vaultTestRunner';

const runner = new VaultTestRunner({
  vaultPath: './ExampleVault',
  verbose: true,
  excludePaths: ['.obsidian', 'node_modules']
});

const results = await runner.runTests();
const report = runner.generateReport(results);
```

## Writing Tests as an AI Agent

### Step 1: Identify What to Test

**Good candidates for unit tests:**
- Pure functions (parsers, serializers)
- Regular expressions
- Data transformations
- Business logic

**Good candidates for e2e tests:**
- Task parsing from real files
- Format validation
- Integration between components
- Vault structure changes

### Step 2: Choose Test Template

**For unit tests:**
```typescript
// tests/unit/myFeature.test.ts
import { myFunction } from '../../src/myFeature';

describe('myFunction', () => {
  it('should handle basic case', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should handle edge case', () => {
    const result = myFunction('');
    expect(result).toBe('default');
  });
});
```

**For e2e tests:**
```typescript
// tests/e2e/myFeature.test.ts
import { VaultTestRunner } from './vaultTestRunner';

describe('My Feature', () => {
  let runner: VaultTestRunner;

  beforeAll(async () => {
    runner = new VaultTestRunner({ vaultPath: './ExampleVault' });
    await runner.loadVault();
  });

  it('should validate feature', async () => {
    const results = await runner.runTests();
    expect(results.every(r => r.passed)).toBe(true);
  });
});
```

### Step 3: Run and Iterate

```bash
# Run in watch mode while developing
pnpm test:watch

# Focus on specific file
pnpm test myFeature.test.ts

# Check coverage
pnpm test:coverage
```

## CI/CD Integration

Tests run automatically on GitHub Actions:

**Triggers:**
- Push to main/master/develop
- Pull requests
- Manual workflow dispatch

**Matrix testing:**
- Node.js 18.x
- Node.js 20.x

**Steps:**
1. Lint check
2. Unit tests
3. E2E vault tests
4. Coverage report (uploaded to Codecov)
5. Vault structure validation

## Key Testing Principles

### 1. Deterministic
Tests always produce the same result. No random data, no time-dependent behavior.

### 2. Isolated
Tests don't depend on external state or other tests. Each test can run independently.

### 3. Fast
Unit tests run in < 1 second. E2E tests in < 5 seconds. Fast feedback loop is critical.

### 4. Readable
Test names clearly describe what's being tested:
- ✅ `should parse task with due date`
- ❌ `test1`

### 5. Maintainable
Use fixtures and helpers to reduce duplication:
- Shared test data in `fixtures/`
- Common setup in `helpers/`
- Reusable mocks in `mocks/`

## Troubleshooting

### Tests fail with "Cannot find module 'obsidian'"

Check `jest.config.cjs` moduleNameMapper:
```javascript
moduleNameMapper: {
  'obsidian': '<rootDir>/tests/mocks/obsidian.ts',
}
```

### E2E tests not finding files

Verify ExampleVault structure:
```bash
ls ExampleVault/*.md
```

Ensure paths are relative to project root:
```typescript
const vaultPath = path.join(__dirname, '../../ExampleVault');
```

### Mock API missing methods

Add to `tests/mocks/obsidian.ts`:
```typescript
export class Vault {
  async myNewMethod() {
    // Mock implementation
  }
}
```

### Coverage reports incomplete

Run with coverage flag:
```bash
pnpm test:coverage
open coverage/lcov-report/index.html
```

## Why This Approach?

### ✅ Advantages

1. **No Obsidian Required** - Tests run without launching the app
2. **Fast Execution** - Unit tests in < 1s, E2E in < 5s
3. **CI/CD Ready** - Works in GitHub Actions without special setup
4. **AI-Friendly** - Deterministic, well-structured, easy to understand
5. **Real Validation** - E2E tests use actual vault files
6. **Comprehensive** - Covers parsing, serialization, and integration

### ❌ Limitations

1. **Not True E2E** - Doesn't test full Obsidian integration
2. **Mock Limitations** - Mocks may not match real Obsidian behavior exactly
3. **No UI Testing** - Doesn't test React components in real Obsidian
4. **Manual Validation** - Still need manual testing for final verification

### 🎯 When to Use Each

**Use unit tests for:**
- Pure logic
- Regular expressions
- Data transformations
- Business rules

**Use e2e-style tests for:**
- Task parsing
- File format validation
- Vault structure
- Integration scenarios

**Use manual testing for:**
- UI/UX verification
- Plugin lifecycle
- Obsidian-specific features
- Final release validation

## Future Enhancements

Potential additions to consider:

1. **Component Testing** - React Testing Library for UI components
2. **Integration Tests** - Test tasksRepo with mocked vault
3. **Performance Tests** - Benchmark parsing large vaults
4. **Snapshot Testing** - Capture and compare serialization output
5. **Property-Based Testing** - Generate random valid tasks
6. **Visual Regression** - Screenshot comparison (if Playwright added)

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library](https://testing-library.com/)
- [Obsidian Testing Guide](https://publish.obsidian.md/hub/04+-+Guides,+Workflows,+&+Courses/Guides/How+to+add+automated+tests+to+your+plugin)
- [Research Notes](./docs/TESTING.md) - Background research on testing approaches

## Summary

This testing framework provides:
- ✅ 61 automated tests (all passing)
- ✅ Fast feedback (< 1 second for unit tests)
- ✅ Real validation (tests against ExampleVault)
- ✅ CI/CD integration (GitHub Actions)
- ✅ AI-friendly utilities (fixtures, helpers, mocks)
- ✅ Comprehensive coverage (parsers, serializers, vault)

The pragmatic approach balances:
- **Practical** - Works without Obsidian running
- **Fast** - Quick feedback loop for development
- **Comprehensive** - Covers critical functionality
- **Maintainable** - Easy to understand and extend

Perfect for AI agents working on this codebase! 🤖✨
