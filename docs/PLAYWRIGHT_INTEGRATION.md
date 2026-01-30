# Playwright Integration Guide (Future Enhancement)

## Overview

This document outlines how to add Playwright e2e testing if needed in the future. **Note:** This is optional and adds significant complexity.

## Prerequisites

```bash
pnpm add -D playwright @playwright/test
pnpm exec playwright install
```

## Challenges with Obsidian + Playwright

### Issue 1: Obsidian Launch Timeout (2024+)

Since 2024, Obsidian cannot be launched from Playwright due to `EnableNodeCliInspectArguments` fuse being disabled.

**Workaround:**
1. Extract Obsidian source files using `asar extract`
2. Create modified app.asar that Playwright can launch
3. Point Playwright to modified Obsidian installation

### Issue 2: Plugin Loading

Need to ensure your plugin is loaded in the test Obsidian instance:
- Copy plugin files to test vault `.obsidian/plugins/`
- Enable plugin in test vault settings
- May need to mock certain APIs

### Issue 3: CI/CD Complexity

GitHub Actions needs Xvfb for headless testing:

```yaml
# .github/workflows/playwright.yml
name: Playwright Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install dependencies
        run: pnpm install
      - name: Install Playwright Browsers
        run: pnpm exec playwright install --with-deps
      - name: Setup Xvfb (virtual display)
        run: |
          sudo apt-get install -y xvfb
          export DISPLAY=:99
          Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
      - name: Run Playwright tests
        run: pnpm test:playwright
```

## Sample Playwright Configuration

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright',
  timeout: 30000,
  fullyParallel: false, // Obsidian can't run multiple instances
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Must be 1 for Electron apps
  reporter: 'html',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'electron',
      use: {
        ...devices['Desktop Chrome'],
        // Custom Electron launch configuration
      },
    },
  ],
});
```

## Sample Test

```typescript
// tests/playwright/plugin.spec.ts
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

test.describe('Tasks Timeline Plugin', () => {
  let electronApp;
  let page;

  test.beforeAll(async () => {
    // Launch modified Obsidian
    electronApp = await electron.launch({
      args: ['path/to/modified/obsidian'],
      env: {
        ...process.env,
        OBSIDIAN_VAULT_PATH: './TestVault',
      },
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('should open timeline view', async () => {
    // Click ribbon icon
    await page.click('[aria-label="Tasks Timeline"]');

    // Verify view opened
    await expect(page.locator('.tasks-timeline-view')).toBeVisible();
  });

  test('should display tasks from vault', async () => {
    // Open timeline
    await page.click('[aria-label="Tasks Timeline"]');

    // Wait for tasks to load
    await page.waitForSelector('.task-item');

    // Verify tasks displayed
    const taskCount = await page.locator('.task-item').count();
    expect(taskCount).toBeGreaterThan(0);
  });

  test('should update task status', async () => {
    await page.click('[aria-label="Tasks Timeline"]');

    // Find first incomplete task
    const task = page.locator('.task-item[data-status="todo"]').first();

    // Click checkbox
    await task.locator('.task-checkbox').click();

    // Verify status changed
    await expect(task).toHaveAttribute('data-status', 'done');

    // Verify markdown file updated
    // (would need to read file and check)
  });
});
```

## Pros and Cons

### ✅ Advantages of Adding Playwright

1. **True E2E Testing** - Tests full application flow
2. **UI Validation** - Verifies visual appearance
3. **User Interaction** - Tests clicks, typing, navigation
4. **Regression Testing** - Catches UI bugs
5. **Screenshots** - Visual debugging

### ❌ Disadvantages

1. **Complex Setup** - Requires Obsidian modification
2. **Slow Execution** - 10-30 seconds per test
3. **Brittle Tests** - UI changes break tests
4. **CI/CD Overhead** - Needs Xvfb, larger runners
5. **Maintenance** - More code to maintain
6. **Limited Community Support** - Few Obsidian plugins use it

## Recommendation

**For most Obsidian plugins, including this one:**

### Current Approach (Jest + E2E-style) is Better ✅

**Reasons:**
1. 61 tests run in < 1 second (vs 10+ seconds with Playwright)
2. No complex Obsidian modification needed
3. Easy to maintain and debug
4. Works great in CI/CD
5. Tests the important parts (parsing, serialization, logic)

### When to Consider Playwright

Only add Playwright if:
- [ ] Plugin has complex UI interactions
- [ ] Need to test visual layout
- [ ] Have resources for maintenance
- [ ] Team has Playwright expertise
- [ ] UI bugs are common
- [ ] Manual testing is too time-consuming

### Alternative: Component Testing

For React component testing, consider **React Testing Library** instead:

```bash
pnpm add -D @testing-library/react @testing-library/jest-dom
```

```typescript
// tests/components/TimelineView.test.tsx
import { render, screen } from '@testing-library/react';
import { TasksTimelineApp } from '@tasks-timeline/components';

test('renders timeline with tasks', () => {
  const tasks = [
    { id: '1', title: 'Test task', status: 'todo', ... }
  ];

  render(<TasksTimelineApp tasks={tasks} />);

  expect(screen.getByText('Test task')).toBeInTheDocument();
});
```

**Benefits:**
- ✅ Tests React components
- ✅ Fast execution
- ✅ No Electron/Obsidian needed
- ✅ Easy to debug
- ✅ Well-documented

## Resources

- [Playwright Electron Testing](https://playwright.dev/docs/api/class-electron)
- [Testing Electron Apps with Playwright](https://dev.to/kubeshop/testing-electron-apps-with-playwright-3f89)
- [Obsidian Plugin E2E Discussion](https://forum.obsidian.md/t/standard-approach-for-writing-automated-end-to-end-tests-for-plugins/31535)
- [Electron Testing on Headless CI](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)

## Conclusion

Playwright is a powerful tool, but for Obsidian plugins:
- **Current Jest approach is more practical**
- **Playwright adds complexity without proportional benefit**
- **Only consider if you have specific UI testing needs**

The testing framework we built provides excellent coverage without the complexity of Playwright.
