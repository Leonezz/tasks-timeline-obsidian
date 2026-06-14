# Agent Conversation UI Audit

Date: 2026-06-14
Scope: Agent conversation panel, process trajectory, agent toasts, markdown rendering, and session controls in the running Tasks Timeline plugin.

Runtime and source evidence:
- `obsidian plugin:reload id=tasks-timeline` completed during the audit pass.
- `obsidian dev:errors limit=30` reported: No errors captured.
- Runtime screenshot evidence from the active right-pane timeline view: `/private/tmp/tasks-timeline-runtime-audit-after-activate.png`.
- Installed component package is `@tasks-timeline/components@0.4.17`.
- Installed package now includes `react-markdown@^10.1.0` and `remark-gfm@^4.0.1`; the markdown renderer passes `remarkPlugins` and includes table, thead, tbody, th, and td renderers.
- Installed `AgentConversationPanel` code includes copy trajectory, delete current conversation, grouped `Agent process`, nested collapsible payload details, and conditional `New conversation` tab rendering only while composing a new thread.
- Runtime agent audit confirmed: new-conversation state, reply bar placeholder, process and `Thinking` disclosure blocks, markdown table rendering, and copy trajectory are working.
- The Obsidian CLI could see the plugin host and screenshot the right-pane UI, but normal `dev:dom` could not reliably serialize the inner shadow-root React tree.

## TODO findings

- [x] P1 - Add a visible cancel/exit affordance for the `New conversation` draft state.
  Evidence: after pressing the plus button, the panel enters a draft state with a `New conversation` tab and empty body. The only clear way out is selecting an existing session tab or sending a new message. In a narrow vertical layout this can still feel like the previous conversation disappeared.

- [x] P1 - Add confirmation or undo for deleting the current agent conversation.
  Evidence: the header trash button deletes the active session immediately. The recent bug where delete cleared all sessions is fixed in `0.4.17`, but destructive session removal is still one click, close to the plus and collapse buttons, with no undo path.
- [x] P1 - Show explicit feedback after deleting an agent conversation.
  Evidence: runtime audit found that clicking `Delete current agent conversation` removed the session and returned to `No agent sessions yet`, but no confirmation, undo, or toast appeared.

- [x] P1 - Keep live agent progress visible while a run is active.
  Evidence: process entries are now grouped into one collapsed `Agent process` block by default. This satisfies the request to collapse the trajectory, but while a session is running it can hide the only active status signal (`Connecting to provider`, `Thinking`, `Using tool`, `Reviewing tool results`) unless the user manually expands it.

- [x] P1 - Auto-scroll the conversation to the newest user, process, and agent entries.
  Evidence: the panel render path groups entries and renders them inside a bounded scroll area, but the installed component code does not show a bottom-anchor or `scrollIntoView` behavior. Long process blocks or markdown answers can leave the latest reply hidden behind the panel scroll position.

- [x] P1 - Make copy trajectory feedback visible as text, not only an icon/title state.
  Evidence: the copy button changes icon/title between copy/check/error states for about 1600 ms. There is no visible status text or Obsidian Notice, so users may miss whether the trajectory was copied or failed.

- [x] P2 - Add a clipboard fallback for Obsidian desktop contexts.
  Evidence: copy uses `navigator.clipboard.writeText` and reports an error state if the Clipboard API is unavailable. Obsidian desktop/plugin contexts can vary by permission and focus, so a fallback or user-visible failure message would make trajectory capture more reliable.

- [x] P2 - Expose session tabs as a semantic tab list or listbox.
  Evidence: session chips use buttons with `aria-pressed`, but the UI behaves like mutually exclusive session selection. A `tablist`/`tab` pattern or a labeled listbox would communicate session selection more clearly to keyboard and screen-reader users.

- [x] P2 - Improve session tab naming and metadata density.
  Evidence: historical tabs show only time/status and a truncated prompt. Runtime audit found no `aria-label` or `title` exposing the full prompt for a completed session tab. The current `New conversation` draft tab uses generic labels (`New conversation`, `New thread`). Add clearer active state, session count, provider/model metadata, and stable labels for repeated prompts.

- [x] P2 - Add an accessible label to the agent composer textarea.
  Evidence: the reply textarea currently relies on placeholder text (`Reply to this agent conversation...`, `Start a new agent conversation...`) to explain purpose. Placeholder-only labeling is weak for screen readers and disappears once the user types.

- [x] P2 - Add copy controls for individual agent replies and tool payload blocks.
  Evidence: only the full trajectory can be copied from the header. Debugging often needs just one assistant answer, one tool call payload, or one tool result payload.

- [x] P2 - Render process payloads in a more inspectable format for large objects.
  Evidence: payload formatting truncates preview text at about 900 characters and shows raw JSON in nested `details`. Large tool calls/results need search, copy, full expansion, or a clearer truncated indicator to support inspection.

- [x] P2 - Keep markdown table QA in the runtime checklist.
  Evidence: `react-markdown` and `remark-gfm` are installed and table renderers exist, so table support is expected. The remaining risk is layout: narrow right panes can force horizontal table scrolling, and compact toast rendering may make tables hard to read.

- [ ] P2 - Re-check the panel collapse interaction with a click-based runtime test.
  Evidence: runtime audit confirmed the `Collapse agent conversation` control exists, but automated eval-click verification was inconclusive.

- [ ] P3 - Complete a visual audit for agentic toasts.
  Evidence: runtime audit did not observe a toast for a panel-visible successful reply or after deleting a conversation. Screenshot/CUA coverage was blocked, so toast placement, persistence, and interaction still need a visual pass.

- [x] P3 - Label process and payload disclosure controls more explicitly.
  Evidence: native `details`/`summary` provides basic disclosure semantics, but nested rows are visually dense and use generic labels such as `Payload`. Add clearer summaries like `Tool call payload`, `Tool result payload`, and step counts.

- [x] P3 - Avoid overlapping panel scrollbars with the Obsidian right-pane scrollbar.
  Evidence: the conversation body has its own bounded scroll area inside a narrow right sidebar, while Obsidian also shows a pane scrollbar. This nested-scroll model is functional but can be awkward in the vertical layout.

## Verified

- The installed package no longer uses a hand-rolled markdown parser for agent messages/toasts; it depends on `react-markdown` and `remark-gfm`.
- Agent toasts use markdown rendering for description/body content.
- Agent-generated notification toasts default to no auto-dismiss when emitted through the agent notify path (`timeout` defaults to `null`).
- The `0.4.17` panel code includes the requested full-trajectory copy button and grouped collapsible process block.
- Runtime audit confirmed markdown tables render in the agent conversation surface.
- Resolved in component package: added draft exit, delete confirmation and feedback, sticky live progress, auto-scroll, visible copy status, clipboard fallback, per-entry/payload copy, tablist semantics, composer label, clearer process/payload labels, toast accessibility hooks, and overscroll containment. Validation passed with component type-check, lint, focused tests, full tests, and build.
