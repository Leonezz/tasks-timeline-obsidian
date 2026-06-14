# AI architecture

Tasks Timeline has two AI surfaces:

- Internal AI: the assistant embedded in the timeline UI.
- External AI: MCP clients that connect to the local Obsidian server.

These surfaces should be unified at the task capability layer, not at the
provider credential layer. External MCP clients bring their own model and
credentials; the plugin should expose vault-safe task capabilities. Internal AI
can use a configured provider, but it should call the same task semantics.

## Shared capability contract

`src/taskCapabilities.ts` is the host adapter for Obsidian task capabilities.
It owns:

- task reads and writes through `ObsidianTasksRepo`
- security blocklist enforcement for reads, creates, updates, and deletes
- host notifications through Obsidian notices
- app settings exposed to capability implementations

`src/mcpServer.ts` exposes only natural task capabilities over MCP:

- `query_tasks`
- `get_task_stats`
- `get_today_plan`
- `create_task`
- `update_task`
- `batch_update_tasks`
- `complete_task`
- `cancel_task`
- `delete_task`

UI-only interaction helpers such as `ask_user` and `notify_user` are intentionally
not exposed over MCP until they have real Obsidian UX for confirmation,
selection, prompts, and toast rendering.

## Provider strategy

Current plugin release state:

- The Obsidian plugin currently depends on `@tasks-timeline/components@0.4.3`.
- The plugin keeps `openai`, `@google/genai`, and `@anthropic-ai/sdk` until it
  is wired to a published component package that supports host provider
  injection.
- External MCP remains model-agnostic and does not reuse internal provider keys.

Implemented in the sibling component package for the next component release:

- `TasksTimelineApp` accepts `aiProviderFactory`, `aiCapabilityContext`, and
  `aiCapabilities`.
- `useAIAgent` accepts the same injection options while preserving the current
  default provider path.
- `expr-eval` has been removed from custom filtering and sorting, replaced by a
  small safe expression evaluator.

Target plugin state:

- Move provider execution behind an injected `AIClient` or `ProviderFactory`
  interface in `@tasks-timeline/components`.
- Prefer one provider-neutral HTTP path from the Obsidian host, using Obsidian
  `requestUrl` and an OpenAI-compatible endpoint or gateway where possible.
- Keep provider-specific adapters optional. The plugin should not bundle every
  provider SDK unless that adapter is enabled or explicitly installed.
- Let both internal AI and MCP call the same task capability contract.

This matches the current market direction: provider-neutral model interfaces
reduce vendor lock-in and OpenAI-compatible gateways are common integration
points.

References:

- Vercel AI SDK documents a standardized provider interface and OpenAI
  compatible provider: https://ai-sdk.dev/docs/foundations/providers-and-models
- LiteLLM documents an OpenAI-compatible proxy for many model providers:
  https://docs.litellm.ai/docs/proxy_server
- MCP tools are model-invoked external-system capabilities with schemas,
  structured content, and security expectations:
  https://modelcontextprotocol.io/specification/2025-06-18/server/tools

## Remaining upstream work

- Publish `@tasks-timeline/components@0.4.4`.
- Update this plugin from `@tasks-timeline/components@0.4.3` to `0.4.4`.
- After the plugin uses injected provider/capability options, remove direct
  provider SDK dependencies unless a specific adapter requires them.
