# Testing Guide for Tasks Timeline Obsidian

This guide explains the testing setup optimized for AI agents working on this plugin.

## Test Architecture

### 1. **Unit Tests** (`tests/unit/`)
Pure logic testing without Obsidian dependencies.

```bash
pnpm test:unit
```

**What's tested:**
- `serializers.test.ts` - Task to markdown conversion
- `tasksRegex.test.ts` - Regular expression patterns

**AI Agent Tips:**
- These tests run fast and are deterministic
- Perfect for TDD workflows
- No mocking needed for pure functions

### 2. **E2E-Style Vault Tests** (`tests/e2e/`)
Tests against real vault structure without launching Obsidian.

```bash
pnpm test:vault
```

**What's tested:**
- Real markdown files in `ExampleVault/`
- Task parsing across different formats
- Metadata extraction
- File structure validation

**AI Agent Tips:**
- Simulates real Obsidian behavior
- Can run in CI/CD without Obsidian installed
- Add new test cases by creating markdown files in ExampleVault
- Use `VaultTestRunner` for custom test scenarios

### 3. **Integration Tests**
Tests with mocked Obsidian APIs (coming soon).

## Test Utilities for AI Agents

### Test Fixtures (`tests/fixtures/`)

```typescript
import { SAMPLE_TASKS, SAMPLE_FILES } from './fixtures/sampleTasks';

// Use predefined task formats
const task = SAMPLE_TASKS.withDueDate; // '- [ ] Task 📅 2024-01-15'
```

### Test Helpers (`tests/helpers/`)

```typescript
import { TestVault, createTestScenario } from './helpers/testHelpers';

// Create a test vault with files
const vault = new TestVault();
vault.addFile('tasks.md', '- [ ] My task', metadata);

// Or use predefined scenarios
const vault = createTestScenario('complex');
```

### Vault Test Runner

```typescript
import { VaultTestRunner } from './e2e/vaultTestRunner';

const runner = new VaultTestRunner({
  vaultPath: './ExampleVault',
  verbose: true
});

const results = await runner.runTests();
```

## Running Tests

```bash
# Run all tests
pnpm test

# Watch mode (for development)
pnpm test:watch

# Coverage report
pnpm test:coverage

# Specific test suites
pnpm test:unit       # Only unit tests
pnpm test:e2e        # Only e2e tests
pnpm test:vault      # Vault validation with verbose output
```

## Writing New Tests

### Unit Test Template

```typescript
// tests/unit/myModule.test.ts
import { myFunction } from '../../src/myModule';

describe('myFunction', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

### E2E Test Template

```typescript
// tests/e2e/myFeature.test.ts
import { VaultTestRunner } from './vaultTestRunner';

describe('My Feature E2E', () => {
  let runner: VaultTestRunner;

  beforeAll(async () => {
    runner = new VaultTestRunner({ vaultPath: './ExampleVault' });
    await runner.loadVault();
  });

  it('should handle my feature', async () => {
    const results = await runner.runTests();
    expect(results.every(r => r.passed)).toBe(true);
  });
});
```

## CI/CD Integration

Tests run automatically on:
- Push to main/master/develop branches
- Pull requests
- Manual workflow dispatch

See `.github/workflows/test.yml` for configuration.

## Coverage Reports

After running tests with coverage:

```bash
pnpm test:coverage
```

View the report at `coverage/lcov-report/index.html`

## Troubleshooting

### Tests fail locally but pass in CI
- Check Node.js version (CI uses 18.x and 20.x)
- Ensure pnpm is at version 10+
- Clear cache: `pnpm store prune`

### Vault tests not finding files
- Ensure `ExampleVault/` directory exists
- Check file paths are relative to project root
- Verify markdown files have `.md` extension

### Mock issues
- Check `tests/mocks/obsidian.ts` for available mocks
- Ensure jest.config.ts moduleNameMapper is correct
- Clear Jest cache: `pnpm test --clearCache`

## Key Testing Principles for AI Agents

1. **Deterministic** - Tests should always produce the same result
2. **Isolated** - Tests don't depend on external state
3. **Fast** - Unit tests run in milliseconds
4. **Readable** - Test names clearly describe what's being tested
5. **Maintainable** - Use helpers and fixtures to reduce duplication

## Real E2E Testing (Optional)

For true end-to-end testing with Obsidian:

**Challenges:**
- Obsidian uses Electron (hard to automate)
- Requires complex Playwright + Electron setup
- Not suitable for CI/CD

**Alternative Approach:**
- Use our e2e-style tests (current implementation)
- Manual testing in real Obsidian for final validation
- Use BRAT for beta testing

See research notes in conversation for Playwright + Electron approach if needed.

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Obsidian Plugin Testing Guide](https://publish.obsidian.md/hub/04+-+Guides,+Workflows,+&+Courses/Guides/How+to+add+automated+tests+to+your+plugin)
