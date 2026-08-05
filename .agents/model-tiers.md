# Agent capability tiers

Use capability tiers in shared workflows instead of hard-coding provider model names.
Resolve each tier to the best available model or agent at dispatch time.

| Tier | Use for | Claude family | OpenAI family |
|------|---------|---------------|---------------|
| `frontier` | Orchestration, design specifications, architecture, **judgment review** (cross-mechanic spec lenses; code-review lenses whose findings come from open-ended reasoning rather than a written checklist), validation of blocker or major findings | Opus — **never Fable.** Fable is the main-session model: it orchestrates, designs, writes the per-agent briefs, and verifies every critical/major finding itself. It is never dispatched as a subagent (cost; and the brief-attack-verify sandwich is what makes Opus lenses safe on hard reviews). | `review-frontier`: `gpt-5.6-sol` with `high` reasoning |
| `strong` | Substantive implementation where the scope is bounded; **checklist review** — lenses that verify explicit written invariants or run a stated procedure (the rules exist on paper; the agent's job is to check them against the diff) | Sonnet | `review-strong`: `gpt-5.6-terra` with `high` reasoning |
| `fast` | Mechanical checks, simple implementations, rule-matching review (conventions against a written rule list), and validation of clear minor findings | Haiku | `review-fast`: `gpt-5.6-luna` with `medium` reasoning |

Which review lens is judgment vs checklist is decided per skill — each review skill's effort dial names its lenses' tiers explicitly; this file only defines what the tiers mean.

**Reasoning effort is a separate axis and is never inherited silently.** Every subagent dispatch states an explicit effort. Ceiling is `high` by default across all tiers; `xhigh` only when the user explicitly asks for a deep run (a session running at high/xhigh would otherwise silently multiply its effort across every agent in a fan-out). Mechanical `fast`-tier work runs `medium` or `low`.

The OpenAI mappings above are enforced by project-scoped custom agents in `.codex/agents/`. Model names and availability change; verify spawn metadata and preserve the tier's responsibility when an exact mapping is unavailable. If the harness cannot choose a model per subagent, use the available subagent and compensate with explicit scope, evidence requirements, and verification by the orchestrator. Never downgrade design-spec work, cross-mechanic spec lenses, architectural gating, or blocker/major validation below `frontier` merely to save time.
