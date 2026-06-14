# Tasks Timeline UI/UX TODO Index

Date: 2026-06-14
Scope: Consolidated index for the parallel agent audit of the running Tasks Timeline Obsidian plugin.

Audit notes:
- [[Agent Audits/Timeline UI Audit]]
- [[Agent Audits/Controls Settings Voice Audit]]
- [[Agent Audits/Agent Conversation UI Audit]]

## Priority TODOs

- [x] P1 - Add accessible labels, pressed states, expanded states, and focus rings to icon-only buttons, filter chips, metric cards, day/year controls, task row actions, and agent conversation controls.
- [x] P1 - Increase touch/click target sizes for toolbar icons, task controls, filter popover checkboxes, per-day add controls, and settings toggles toward the Obsidian 44x44 px guidance.
- [x] P1 - Make focus-mode empty state actionable when counters show tasks but the main view says there are no tasks for today.
- [x] P1 - Fix settings defaults/migration so `tokenUsageByModel` is always present before rendering AI token usage.
- [x] P1 - Add a clear cancel/exit path for the agent panel's new-conversation draft state.
- [x] P1 - Add confirmation or undo for deleting agent conversation sessions.
- [x] P1 - Show explicit feedback after deleting an agent conversation.
- [x] P1 - Keep live agent progress visible while running, even when the full process trajectory is collapsed.
- [x] P1 - Auto-scroll agent conversations to the newest user, process, and assistant entries.
- [x] P2 - Improve backlog discoverability in the vertical right-pane layout.
- [x] P2 - Make provider/model selectors and session selectors semantic segmented/listbox/tab controls with selected state.
- [x] P2 - Add clearer provider/model defaults, validation, and untruncated test-connection details.
- [x] P2 - Add visible copy-status feedback and a clipboard fallback for agent trajectory copying.
- [x] P2 - Add an accessible label and clearer state to the agent composer and session tabs.
- [x] P2 - Add copy controls for individual assistant replies and tool payload/result blocks.
- [ ] P2 - Re-check the agent panel collapse interaction with a click-based runtime test.
- [x] P2 - Keep markdown table rendering in runtime QA for agent replies and toasts in narrow panes.
- [ ] P3 - Complete a visual audit for agentic toast placement, persistence, and interactions.
- [x] P3 - Review Obsidian sentence-case guidance for component settings text.
- [x] P3 - Reduce nested-scroll friction between the agent conversation panel and the Obsidian right sidebar.

## Runtime status

- Obsidian plugin reload succeeded during the audit.
- `obsidian dev:errors limit=30` reported no captured errors.
- The current running view is in the right sidebar/vertical layout.
- Shadow DOM limits made full `dev:dom` serialization inconsistent; findings combine screenshot evidence, app-context inspection, and installed component package evidence.
- Resolved items were implemented in the component package and wrapper settings defaults on 2026-06-14. Remaining unchecked items require a fresh runtime click/screenshot pass inside Obsidian.
