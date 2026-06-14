# Controls, settings, and voice audit

Date: 2026-06-14

Scope: controls, settings, voice affordances, provider/model controls, keyboard behavior, and general interaction UX for the Tasks Timeline Obsidian plugin.

Runtime notes:
- Obsidian `dev:errors limit=30` reported: "No errors captured."
- Obsidian `dev:dom selector=".workspace-leaf-content[data-type='tasks-timeline']"` confirmed the running app has an active `Tasks Timeline` view and `.tasks-timeline-view-host`.
- The available `dev:dom` serializes `.tasks-timeline-view-host` as an empty shadow host, so the main toolbar/input/mic controls inside the shadow root were inspected from the installed component source map instead of live DOM.
- `dev:dom selector=".tasks-timeline-view-host input"` found no elements because of the shadow boundary.
- `eval`, `dev:css`, `dev:console`, and `dev:screenshot path=...` were unavailable or returned no useful output with the installed Obsidian CLI, which also warned that the installer is out of date.
- Native CUA inspection was attempted, but the daemon was not running, the permission check hung and exited, and `list_apps` did not see Obsidian as running. No native clicks were used.
- Settings UI was not live-inspected for the same shadow/runtime limitations; settings findings below are from `src/settings.tsx` and the installed `@tasks-timeline/components` source map.

TODO findings:

- [x] P1 - Backfill `tokenUsageByModel` in defaults and migrations so the AI settings tab cannot crash on a fresh or partially migrated config.
  Evidence: `@tasks-timeline/components` requires `AppSettings.tokenUsageByModel` (`node_modules/@tasks-timeline/components/dist/types.d.ts:86-87`) and `SettingsPageAI` calls `Object.keys(settings.tokenUsageByModel)` before rendering token stats. The plugin default only sets `totalTokenUsage: 0` and then jumps to `defaultCategory` (`src/settings.tsx:88-90`), so `tokenUsageByModel` can be undefined.

- [x] P1 - Add accessible names and state to the main input-bar icon buttons.
  Evidence: the main input's mic, AI mode, and settings buttons use icon-only UI plus `title`, but no `aria-label`; only the agent conversation button has `aria-label` (`InputBar.tsx source-map lines 203-237 and 263-272`). The AI mode button also visually toggles active state without `aria-pressed`.

- [x] P1 - Make the per-day add-row voice control keyboard reachable and labeled.
  Evidence: the per-day plus action has no accessible name (`DaySection.tsx source-map lines 264-282`), and the per-day mic button is explicitly removed from tab order with `tabIndex={-1}` while relying on title text (`DaySection.tsx source-map lines 346-362`).

- [x] P1 - Give settings toggles programmatic labels and pressed state across the component settings pages.
  Evidence: local MCP toggles use `aria-label` and `aria-pressed` (`src/settings.tsx:169-173`), but component settings toggles are bare buttons with adjacent visible text only, including AI enable/default (`SettingsPageAI.tsx source-map lines 288-337`), voice enable (`SettingsPageAI.tsx source-map lines 554-568`), general view toggles (`ViewSection.tsx source-map lines 63-167`), and input-bar item toggles (`SettingsPageGeneral.tsx source-map lines 194-208`).

- [x] P2 - Convert provider and model selectors to semantic segmented/listbox controls with selected state.
  Evidence: AI provider and voice provider choices are plain buttons with visual-only active styling (`SettingsPageAI.tsx source-map lines 341-363 and 574-599`). They do not expose `aria-pressed`, `aria-selected`, `role="tablist"`, or equivalent state, so screen-reader users cannot reliably know which provider is active.

- [x] P2 - Improve provider/model controls beyond raw free-text fields.
  Evidence: provider config uses text inputs for model and base URL with placeholders only (`SettingsPageAI.tsx source-map lines 389-426`), while the plugin defaults leave all provider model values empty (`src/settings.tsx:49-68`). Add default model values, reset-to-default affordances, validation, and clearer errors for unsupported provider/model combinations.

- [x] P2 - Do not truncate provider test failures without a details affordance.
  Evidence: `Test Connection` displays only the first 60 characters of a failure or success message (`SettingsPageAI.tsx source-map lines 471-501`). For API-key, base-URL, model, or Responses API failures, this can hide the actionable part of the provider error.

- [x] P2 - Expand keyboard behavior for task inputs.
  Evidence: the main input submits on Enter only (`InputBar.tsx source-map lines 64-68`) and has no Escape handling to clear/cancel, no composition guard for IME input, and no `preventDefault` around submit. The per-day input handles Enter/Escape (`DaySection.tsx source-map lines 122-130`), but the main input and per-day input should be consistent.

- [x] P2 - Align settings text with Obsidian sentence-case guidance.
  Evidence: headings and labels include title case such as "AI Agent", "Voice Input", "Settings Button", "Filters & Sorting", "Reset Stats", "Test Connection", "Custom System Prompt", "Base URL", "Show Completed", and "Default Focus Mode" across the component settings pages (`SettingsPage.tsx`, `SettingsPageAI.tsx`, `SettingsPageGeneral.tsx`, `ViewSection.tsx` source-map evidence). Obsidian guidance expects sentence case for UI text.

- [x] P3 - Review touch target sizes for dense toolbar and inline buttons.

Resolved 2026-06-14:
- Wrapper defaults now include `tokenUsageByModel`, settings version was bumped, and legacy migration test coverage was added.
- Shared component controls now expose labels/pressed states, IME-safe Enter handling, Escape clear behavior, provider validation, reset-to-default controls, full test-connection messages, and sentence-case settings text.
- Validation passed with component type-check/lint/focused tests/full tests/build and wrapper lint/test/build.
  Evidence: main input icon buttons use `p-1` to `p-1.5` around 16px icons (`InputBar.tsx source-map lines 203-237 and 263-272`), per-day add/mic controls are 24px or smaller (`DaySection.tsx source-map lines 264-282 and 346-362`), and several settings toggles are 36-40px wide by 20-24px tall. Obsidian accessibility guidance calls for 44px minimum touch targets.
