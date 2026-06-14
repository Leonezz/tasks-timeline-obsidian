# Agentic agent UI design

Date: 2026-06-14
Scope: Task 2, interactive agent response UX for `tasks-timeline-obsidian`.

## Problem

The current internal AI path starts from the shared `InputBar`, runs through
`useAIAgent`, and renders most user-visible agent output through transient
toasts. This is useful for short notifications, but it is not agentic enough for
task workflows where the user needs to review context, answer clarifying
questions, approve writes, compare task changes, or return to prior agent work.

The shared package already has enriched toast types, `confirm`, `select`, and
`prompt` helpers, plus `ask_user` and `notify_user` capability tools. That is a
good interaction primitive, but it should not be the main agent surface. Toasts
should become short status affordances. Agent conversations, approvals, and
task diffs need a persistent, inspectable workspace.

## Current flow

- `src/view.tsx` mounts `ObsidianAdaptor` inside a shadow root and injects
  `@tasks-timeline/components` CSS.
- `src/obsidianAdapter.tsx` passes tasks, settings, title rendering, and an
  Obsidian-specific system prompt into `TasksTimelineApp`.
- `@tasks-timeline/components/src/TasksTimelineApp.tsx` owns `toasts`,
  `expandedToastId`, `confirmToast`, `selectToast`, and `promptToast`.
- `InputBar` submits natural language to `onAICommand` when AI mode is active.
- `useAIAgent` builds a `CapabilityContext`, executes tool calls, and sends the
  final assistant text to `onNotify("info", "AI", response.text.trim())`.
- `src/taskCapabilities.ts` creates the Obsidian capability context for MCP and
  future AI hosts, but `notify` currently maps to `new Notice(message)`.
- `src/mcpServer.ts` intentionally exposes only task capabilities externally;
  UI-only tools are not exposed over MCP.

## UX direction

Use a three-layer model:

1. Entry: keep `InputBar` as the fast command entry point.
2. Workspace: add a persistent agent conversation panel or drawer for agent
   reasoning, cards, approvals, and history.
3. Inline affordances: connect agent cards back to timeline tasks with preview,
   highlight, jump, and edit actions.

Toasts remain for short success, error, and background status messages. They
should not carry the main response once a task workflow has multiple steps or
needs user review.

## Interface patterns

### Agent conversation panel

Add a right-side drawer on wide layouts and a bottom sheet on narrow layouts.
It should be host-agnostic in the shared package and controlled by
`TasksTimelineApp`.

Core behavior:

- Opens automatically when the user submits an AI command in AI mode.
- Keeps a thread of user messages, assistant messages, tool calls, results, and
  pending decisions.
- Provides a persistent "agent" toggle button near the input bar for reopening
  the latest session.
- Supports keyboard access: `Esc` closes the panel, focus is trapped while a
  modal/bottom sheet is active, pending decision controls are reachable by Tab.
- Uses accessible landmarks and labels: `role="dialog"` for modal mobile sheet,
  `aria-label="Agent conversation"` for the panel, and live regions only for
  short status updates.

Suggested shared components:

- `AgentConversationPanel`
- `AgentThread`
- `AgentMessageBubble`
- `AgentActivityRow`
- `AgentComposerBridge` or a simple "continue" prompt area

The panel should not depend on Obsidian APIs. The plugin can decide whether the
panel is docked in the timeline view or opened in a future dedicated leaf.

### Actionable response cards

Assistant responses should be cards when they contain structured task data or
actions, not plain text in a toast.

Card types:

- `TaskSummaryCard`: compact list returned by `query_tasks` or
  `get_today_plan`, with jump/edit affordances.
- `TaskStatsCard`: counts by status, priority, and overdue state.
- `TaskDiffCard`: proposed or applied task field changes, grouped by task.
- `BulkActionCard`: batch update intent, filter criteria, matched task count,
  and approval controls.
- `ClarificationCard`: free text, single-choice, or confirmation prompt.
- `ToolErrorCard`: failed tool, user-readable cause, retry/edit prompt action.

Cards should use the existing typed detail blocks where possible, but graduate
them from toast-only rendering into reusable agent card renderers.

### Tool-call review and approval

Writes should be reviewable before execution when they are broad, destructive,
or ambiguous.

Recommended policy:

- Always review `delete_task`, `cancel_task`, and `batch_update_tasks`.
- Review `update_task` when more than one meaningful field changes or the title
  changes.
- Review `create_task` only when the agent creates more than one task or picks
  a non-default category.
- Read-only tools show activity rows and result cards, not approval gates.

Approval card actions:

- `Approve`
- `Edit details`
- `Reject`
- `Jump to affected task` when there is one known task

The capability layer currently supports `confirm`, `select`, and `prompt`.
Keep that contract as a fallback, but route those requests into persistent
panel cards instead of toast promises.

### Task diff previews

Before applying a write, show a normalized diff:

- Task title
- Source file/category
- Status, priority, start, due, completion, recurrence
- Added/removed tags
- Affected line when Obsidian metadata is available in `task.extra.position`

For applied changes, keep the card in history with a success state and a "jump
to note" action wired through the existing `onItemClick`/Obsidian open behavior.

Diff generation belongs in the shared package as pure data functions. Obsidian
line-opening belongs in the plugin adapter.

### Persistent history

Start with in-memory history scoped to the current timeline view. Do not persist
conversation content to disk in the first slice because prompts can contain
private task context and provider output.

Later persistence should be opt-in and scoped:

- Store summaries, not full prompts, by default.
- Keep an explicit "clear agent history" action.
- Avoid writing provider transcripts to vault files without user action.

### Inline timeline affordances

Agent cards should connect back to the timeline:

- Highlight tasks referenced by the active agent card.
- Add "ask about this task" and "summarize this file/project" affordances from
  task item overflow menus when that menu exists.
- Allow result cards to temporarily apply a filter, for example "show these 8
  tasks in timeline".
- Use a stable task reference (`task.id` plus `category`/file when available)
  because task IDs can be regenerated for newly parsed tasks.

These features should be incremental. The first panel version can use existing
`onItemClick` and filtered result cards without adding new task-row UI.

## Architecture

### Shared component package

The shared package should own host-agnostic state, rendering, and capability UI
contracts:

- Agent session types:
  - `AgentSession`
  - `AgentMessage`
  - `AgentToolCall`
  - `AgentDecisionRequest`
  - `AgentTaskDiff`
- Agent event sink:
  - `onAgentEvent(event)` prop on `TasksTimelineApp`
  - or an internal `AgentInteractionProvider` used by `useAIAgent`
- Agent UI components:
  - `AgentConversationPanel`
  - `AgentCardRenderer`
  - `TaskDiffCard`
  - `ClarificationCard`
  - `ToolCallCard`
- Existing toast detail blocks should be reused as lower-level renderers where
  useful, not duplicated.

`useAIAgent` should emit structured lifecycle events:

- user message submitted
- provider request started/completed/failed
- tool call proposed
- tool call executing
- tool call completed/failed
- assistant final response
- token usage update

It should not import Obsidian or know where the events render.

### Obsidian plugin host

The plugin should keep ownership of Obsidian-specific behavior:

- `src/obsidianAdapter.tsx`: pass any host callbacks into
  `TasksTimelineApp`, including jump-to-note behavior and host prompt text.
- `src/view.tsx`: keep shadow-root mounting and popout compatibility. Future DOM
  code must use the host/root owner document instead of global `document`.
- `src/taskCapabilities.ts`: keep task persistence, security filtering, and
  host notification fallback.
- `src/mcpServer.ts`: keep external MCP tool exposure separate from internal UI
  interactions.

The plugin should not implement the panel directly unless the shared package
cannot ship it. The components package needs to remain reusable outside
Obsidian.

### Capability and approval model

Do not add a second task semantics layer. Keep all task reads/writes behind
`CapabilityContext` and `createCapabilities`.

Add a host-agnostic approval abstraction:

```typescript
interface AgentInteractionHost {
  appendEvent(event: AgentEvent): void;
  requestDecision(request: AgentDecisionRequest): Promise<AgentDecisionResult>;
}
```

Map current helpers onto it:

- `confirm()` -> `requestDecision({ kind: "confirm" })`
- `select()` -> `requestDecision({ kind: "select" })`
- `prompt()` -> `requestDecision({ kind: "prompt" })`
- `showToast()` -> `appendEvent({ kind: "notification" })` plus optional toast
  fallback for short status

This preserves existing capability tools while enabling the panel to resolve
promises from durable cards.

## Smallest implementation slices

### Slice 1: Evented agent history without behavior changes

Shared package:

- Add agent event/session types.
- Add an in-memory `useAgentSession` hook.
- Update `useAIAgent` to emit events while keeping the current toast callbacks.
- Add tests around event ordering for a simple prompt and a tool-call loop.

Plugin:

- No production behavior change beyond consuming the new package release.

### Slice 2: Read-only conversation panel

Shared package:

- Add `AgentConversationPanel`.
- Add a small button near `InputBar` to open the panel when AI is enabled.
- Render user messages, assistant final responses, tool activity, and errors.
- Keep final response toast as a temporary fallback.

Plugin:

- Validate rendering inside the shadow root and Obsidian popout windows.

### Slice 3: Durable decision cards

Shared package:

- Route `confirm`, `select`, and `prompt` through panel decision cards.
- Keep toast-based interaction as fallback when the panel is disabled.
- Ensure pending cards are keyboard reachable and announce state changes.

Plugin:

- No new Obsidian APIs required.

### Slice 4: Task result and diff cards

Shared package:

- Add card renderers for task lists, stats, and diffs.
- Add pure task-diff helpers for update and batch-update previews.
- Wire high-risk write tools to request approval with diff metadata.

Plugin:

- Pass existing `onItemClick` so cards can jump to notes.
- Keep security checks in `src/taskCapabilities.ts` for MCP and host contexts.

### Slice 5: Inline timeline affordances

Shared package:

- Add optional highlighted task IDs to `TasksProvider` or a dedicated agent
  context.
- Let agent result cards filter/highlight matching timeline tasks.
- Add task-row entry points only after the panel/cards are stable.

Plugin:

- Use existing Obsidian note-opening behavior for jump actions.

## Accessibility and compatibility requirements

- All action cards must be keyboard operable and expose clear button labels.
- Pending decision cards should move focus only when the panel opens because of
  direct user action; background model events should not steal focus.
- Use focus-visible styling and the existing theme tokens/classes.
- Avoid global `window` and `document` in new UI. Use element owner documents or
  context-provided window/document for Obsidian popouts.
- Avoid localStorage/sessionStorage for agent history in the first slice.
- Do not add dependencies. The shared package already has React, Framer Motion,
  Radix primitives, and lucide icons available.
- Do not touch voice input code in this task.

## Risks and open questions

- The shared package currently uses some browser-global assumptions in nearby
  UI. New panel work should not add more globals, and later cleanup may be
  needed for full popout compatibility.
- Provider streaming is not modeled in `useAIAgent` today. The first design
  should support non-streaming messages and leave streaming as a later
  enhancement.
- Task IDs may not be durable across reparses. Cards should carry enough task
  context to recover or degrade gracefully when a task is no longer found.
- External MCP clients do not have an in-plugin approval UI. Keep MCP exposure
  governed by the existing security model unless a separate MCP session review
  feature is explicitly designed.
- Persisted agent history has privacy implications and should not be enabled by
  default.
- Bulk diff previews can become large. Cards need count summaries, pagination or
  collapsing, and a hard cap before rendering many tasks.

## Recommendation

Prioritize a shared, host-agnostic conversation panel backed by structured agent
events. Keep toast interactions as a compatibility fallback, then migrate
approvals and result previews into durable cards. This gives users an agentic
workflow without forking task semantics between the internal AI, Obsidian host,
and MCP server.
