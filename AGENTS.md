# Agentic Workflow Guidelines

This file contains comprehensive instructions for AI agents working on the `tasks-timeline-obsidian` repository.

## 1. Project Overview

- **Type**: Obsidian Community Plugin
- **Description**: A timeline style viewer for tasks within an Obsidian vault.
- **Stack**: TypeScript, React (v19), Vite, Luxon, Parsimmon.
- **Entry Point**: `src/main.ts`
- **Output**: `main.js`, `manifest.json`, `styles.css`

## 2. Build, Lint & Test Commands

### Build System
The project uses `vite` for building.
- **Development (Watch)**:
  ```bash
  npm run dev
  ```
  - Builds to `ExampleVault/.obsidian/plugins/tasks-timeline-obsidian/`.
  - Watches for file changes.
  - Use this when iterating on features.

- **Production Build**:
  ```bash
  npm run build
  ```
  - Builds optimized artifacts to `dist/`.
  - Copies `manifest.json` to `dist/`.
  - **Action**: Run this before submitting any changes to verify the build succeeds.

### Linting
- **Lint**:
  ```bash
  npm run lint
  ```
  - Uses `eslint` with `typescript-eslint` and `eslint-plugin-obsidianmd`.
  - Configuration is in `eslint.config.mts`.
  - **Rule**: Ensure no lint errors remain before finishing a task.

### Testing
- **Status**: No automated test suite is currently configured in `package.json`.
- **Manual Testing**:
  - Open `ExampleVault` in Obsidian.
  - Enable the plugin in "Community Plugins".
  - Verify changes interactively.

## 3. Code Style & Conventions

### Formatting (EditorConfig)
- **Indentation**: Tabs (not spaces).
- **Tab Width**: 4 spaces.
- **Line Endings**: LF.
- **Charset**: UTF-8.
- **Insert Final Newline**: Yes.
- **Action**: Respect these settings when writing files.

### TypeScript & Types
- **Strict Mode**: Enabled (`noImplicitAny`, `strictNullChecks`, `strictBindCallApply`).
- **Target**: ES6 / ESNext.
- **Explicit Types**:
  - Always define return types for exported functions.
  - Use `interface` for object definitions (e.g., `TasksTimelinePluginSettings`).
  - Use `type` for unions/intersections.
- **Obsidian Types**: Import specific types from `obsidian` (e.g., `App`, `Plugin`, `WorkspaceLeaf`).

### React Components
- Located in `src/` (e.g., `view.tsx`, `settings.tsx`).
- **Version**: React 19.
- **Pattern**: Functional Components with Hooks.
- **Mounting**: Uses `createRoot` from `react-dom/client`.
- **Strict Mode**: Components are wrapped in `<React.StrictMode>`.
- **Styling**: Import CSS files directly (e.g., `import "@tasks-timeline/components/index.css"`).

### Naming Conventions
- **Files**: `camelCase.ts` or `camelCase.tsx`.
- **Classes**: `PascalCase` (e.g., `TasksTimelineObsidianPlugin`).
- **Components**: `PascalCase` (e.g., `TasksTimelineObsidianView`).
- **Functions/Variables**: `camelCase`.
- **Constants**: `UPPER_CASE` or `camelCase` if it's a configuration object.
- **Interfaces**: `PascalCase`.

### Imports
- **Ordering**:
  1. External libraries (`obsidian`, `react`, `luxon`)
  2. Internal modules (`./settings`, `./view`)
  3. Types/Interfaces
- **Style**: Use named imports where possible.
- **Path**: Use relative paths or configured aliases if present (Vite config shows `@` alias for `src`).

### Error Handling
- **Async/Await**: Use `try/catch` blocks for async operations.
- **User Feedback**: Use `new Notice("Message")` for user-facing errors.
- **Logging**: Use `console.error` for debugging.
- **Resilience**: Fail gracefully; do not crash the entire plugin.

## 4. Architecture Specifics

### Plugin Lifecycle (`src/main.ts`)
- **onload()**:
  - Load settings.
  - Register views (`TasksTimelineObsidianView`).
  - Register commands.
  - Setup event listeners (DOM, interval).
- **onunload()**:
  - Detach leaves.
  - Disconnect observers.

### Event Bus (`src/eventbus.ts`)
- Uses `TypedBus` for plugin-wide communication.
- Events include `system:themeChange`.
- **Usage**: `this.bus.emit("event", payload)` and `this.bus.on("event", callback)`.

### Parsing Logic (`src/parsers.ts`)
- Handles parsing of task formats (Tasks Plugin, Dataview, etc.).
- Uses `luxon` for date parsing.
- **Key Functions**: `parseTasksFormatItem`, `parseDataViewFormatItem`.
- **Regex**: Defined in `src/tasksRegex.ts` (implied).

### Settings (`src/settings.tsx`)
- Settings are stored in `TasksTimelinePluginSettings`.
- UI is rendered using React in `SampleSettingTab`.
- Persisted via `loadData()` and `saveData()`.

## 5. Agent Workflow Rules

### 1. Investigation
- Always read `package.json` and `src/main.ts` first to understand the context.
- Check `src/types.ts` (if exists) or interfaces in files for data structures.

### 2. Implementation
- **Do not create new files** unless necessary for modularity.
- **Prefer refactoring** existing files over duplication.
- **Dependencies**: Do not add new npm dependencies without explicit instruction.
- **Filesystem**: Do not access files outside the vault.

### 3. Verification
- Run `npm run lint` to check for style violations.
- Run `npm run build` to ensure the code compiles correctly.
- If the build fails, fix the errors before submitting.

### 4. Documentation
- Update JSDoc comments for modified functions.
- Keep this `AGENTS.md` updated if architectural patterns change.

## 6. Directory Structure
- `src/`: Source code
  - `main.ts`: Entry point
  - `view.tsx`: React view container
  - `settings.tsx`: Settings tab
  - `parsers.ts`: Task parsing logic
  - `eventbus.ts`: Event system
- `ExampleVault/`: Sandbox for testing
- `dist/`: Production output
- `assets/`: Static assets

---
*Generated by Agent for Agentic Workflow*
