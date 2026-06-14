# Timeline UI Audit

Date: 2026-06-14
Scope: Main Tasks Timeline view in the running Obsidian ExampleVault.

Runtime evidence:
- `obsidian plugin:reload id=tasks-timeline` completed.
- `obsidian dev:errors limit=30` reported: No errors captured.
- Light screenshot: `/private/tmp/tasks-timeline-audit.png`
- Timeline screenshot with focus mode off: `/private/tmp/tasks-timeline-audit-focus-off.png`
- Dark screenshot: `/private/tmp/tasks-timeline-audit-dark.png`
- Status popover screenshot: `/private/tmp/tasks-timeline-audit-status-popover.png`
- Runtime theme check: body `theme-light` maps the app to `data-theme="light"`; temporary body `theme-dark` maps it to `data-theme="midnight"`.

## TODO findings

- [x] TODO: Add accessible names and pressed/expanded semantics to the top controls and timeline actions.
  Evidence: runtime shadow DOM showed 17 visible buttons in focus mode, with 13 missing `aria-label`. Missing labels included the voice button (`title="Start voice input"` only), AI/manual mode toggle (`title="Switch to manual mode"` only), settings button (`title="Settings and docs"` only), filter chips, Focus toggle, status counters, day header, add-task icon, and add-task text control. With focus mode off, the full rendered timeline exposed 116 buttons and most task/status/date/delete controls also lacked accessible names.

- [x] TODO: Increase interactive target sizes for touch and keyboard usability.
  Evidence: top icon buttons measured 28x28 px; task status/add controls measured 24x24 px; task edit icons measured 20x20 px; delete buttons measured 26x26 px; task metadata chips were 20 px high; Status popover checkboxes measured 13x13 px. The Obsidian plugin guidance expects interactive touch targets around 44x44 px.

- [x] TODO: Make the focus-mode empty state more actionable and less contradictory.
  Evidence: initial light screenshot showed Focus mode enabled, counters showing `32 TO DO` and `2 DOING`, while the main pane said only `Focus mode is on. No tasks for today.` There is no visible CTA to turn off Focus mode, change filters, or jump to backlog/timeline content, so the view can look empty despite many tasks being loaded.

- [x] TODO: Improve top control affordances and copy for filter/counter chips.
  Evidence: the metric cards are clickable filters but visually read as passive counters. The Focus card uses `title="Turn Off Focus Mode"` / `title="Turn On Focus Mode"` but no `aria-pressed`; status counters likewise have no pressed state semantics. The `DUE & OD` label is abbreviated and hard to parse at a glance.

- [x] TODO: Add an accessible name and larger row hit areas in filter popovers.
  Evidence: the Status popover rendered as `role="dialog"` with no accessible name. Its checkbox inputs had no direct `aria-label` and measured 13x13 px. The visible rows are readable visually, but the runtime DOM gives screen readers and touch users weak targets.

- [x] TODO: Improve backlog discoverability when focus mode is off.
  Evidence: at the current right-pane width, runtime layout reported the visible host at about 730 px wide and 1603 px tall, with no horizontal overflow (`scrollW` equaled `clientW`). The backlog header was around y=2603, below the first viewport, after a long timeline (`scrollH` about 4388). Users may not realize undated/backlog items exist unless they scroll far down.

- [x] TODO: Provide a way to reveal full task titles without entering edit mode.
  Evidence: long task titles are truncated in the timeline list, for example `Read SerialAPIMgr market research notes and discuss serialman T02...` in the 2026 section. This prevents scanning the full task text from the timeline view and is especially noticeable in the narrow right sidebar.

- [x] TODO: Add clear keyboard focus styling to all custom action buttons, including day/year/backlog collapse headers and task row controls.
  Evidence: many interactive elements are custom buttons with `outline-none`; some have no replacement focus ring in their class list. Runtime examples include filter chips, the year header button, day header buttons, backlog header, add-task text button, task title button, and several chip/date controls.

## Verified

- Light and dark theme switching worked at runtime. The dark screenshot showed the app using the `midnight` palette and the visible timeline remained readable.
- No horizontal overflow was observed in the current right-sidebar layout.
- Resolved in component package: added labels/states, focus-visible rings, larger compact hit targets, focus-mode CTAs, backlog reveal actions, and title reveal affordances. Validation passed with component type-check, lint, focused accessibility tests, full tests, and build.
