# Agent capability tiers

Use capability tiers in shared workflows instead of hard-coding provider model names.
Resolve each tier to the best available model or agent at dispatch time.

| Tier | Use for | Claude family | OpenAI family |
|------|---------|---------------|---------------|
| `frontier` | Orchestration, design specifications, adversarial review, architecture, validation of blocker or major findings | Fable when available; otherwise Opus | `review-frontier`: `gpt-5.6-sol` with `xhigh` reasoning |
| `strong` | Substantive implementation and focused reasoning review where the scope is bounded | Sonnet | `review-strong`: `gpt-5.6-terra` with `high` reasoning |
| `fast` | Mechanical checks, simple implementations, and validation of clear minor findings | Haiku | `review-fast`: `gpt-5.6-luna` with `medium` reasoning |

The OpenAI mappings above are enforced by project-scoped custom agents in `.codex/agents/`. Model names and availability change; verify spawn metadata and preserve the tier's responsibility when an exact mapping is unavailable. If the harness cannot choose a model per subagent, use the available subagent and compensate with explicit scope, evidence requirements, and verification by the orchestrator. Never downgrade design-spec work, adversarial review, architectural gating, or blocker/major validation below `frontier` merely to save time.
