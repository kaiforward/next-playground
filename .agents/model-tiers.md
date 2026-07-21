# Agent capability tiers

Use capability tiers in shared workflows instead of hard-coding provider model names.
Resolve each tier to the best available model or agent at dispatch time.

| Tier | Use for | Claude family | OpenAI family |
|------|---------|---------------|---------------|
| `frontier` | Orchestration, design specifications, adversarial review, architecture, validation of blocker or major findings | Fable when available; otherwise Opus | The strongest available reasoning/Codex model, such as Sol when available, with high reasoning effort |
| `strong` | Substantive implementation and focused reasoning review where the scope is bounded | Sonnet | The default capable Codex model with medium or high reasoning effort |
| `fast` | Mechanical checks, simple implementations, and validation of clear minor findings | Haiku | The fastest available lightweight Codex model with low or medium reasoning effort |

Model names and availability change. Preserve the tier's responsibility when an exact mapping is unavailable. If the harness cannot choose a model per subagent, use the available subagent and compensate with explicit scope, evidence requirements, and verification by the orchestrator. Never downgrade design-spec work, adversarial review, architectural gating, or blocker/major validation below `frontier` merely to save time.
