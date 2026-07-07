# /uber-review — Multi-Agent Code Review Skill

**Status**: Implemented (see `docs/design/implementation/uber-review-skill.md` for the build plan)
**Date**: 2026-05-26
**Author**: brainstormed with Claude

## Purpose

A project-local code review skill that uses a team of specialized agents to review a PR or local branch in parallel. Each agent reviews through a single narrow lens (boundary-safety, world/tick integrity, data contract, conventions, etc.). An architect agent runs first and can halt the pipeline if it detects an architectural problem severe enough to require approach-level rework.

The goal: catch more issues than a single general-purpose reviewer, with cost controlled by per-agent model selection, file-pattern skip-gates, and tiered LLM validation of findings.

## Invocation

```
/uber-review                          # review current local branch vs main
/uber-review <PR#>                    # review GitHub PR; post summary comment back
/uber-review --effort=quick|standard|deep
/uber-review --only=boundary-safety,world-integrity
/uber-review --skip-architect         # skip the architect/gate pass
/uber-review --threshold=N            # confidence floor for inclusion (default 70)
/uber-review --chunk-size=N           # target chunk size (default 20)
```

**Effort dials:**

| Effort | Architect | Reasoning reviewers | Mechanical reviewers |
|--------|-----------|---------------------|----------------------|
| `quick` | Sonnet | Haiku | Haiku |
| `standard` (default) | Opus | Sonnet | Haiku |
| `deep` | Opus | Sonnet (+ Opus for data-contract & boundary-safety) | Haiku |

`quick` is a smoke-test pass; `standard` is the everyday setting; `deep` is for pre-merge review of large or sensitive changes.

## Pipeline

```
1. Fetch diff
   • Local mode: `git diff main...HEAD` (or compute against the project's main branch)
   • PR mode:    `gh pr diff <#>`

2. ARCHITECT (Opus on standard/deep, Sonnet on quick) — runs on FULL PR diff
   Output: severity { blocker | major | minor | clean } + findings
       ├─ if severity == blocker → STOP. Validate architect findings, render report, exit.
       └─ otherwise → architect findings join the downstream pool; pipeline continues

3. CHUNKER — groups files into semantic clusters (see "Chunking")

4. For each chunk: dispatch reviewers in parallel
   Each reviewer is gated by file-path patterns (see "Skip-gate matrix"). Skipped
   reviewers are logged with reason for auditability.
   Each reviewer returns a JSON array of structured findings (see "Finding schema").

5. DEDUP (orchestrator, deterministic)
   Pass 1: collapse findings sharing (file, normalized-line, category). Keep highest
           severity; concatenate messages; record co-flagging agents.
   Pass 2 (only when triggered): same (file, line-overlap) with different categories
           from different agents → fire one Haiku call: "are these the same underlying
           issue?". If yes, merge. If no, keep both.

6. VALIDATE (tiered)
   • blocker + major → Opus validator (per-finding)
   • minor           → Haiku validator (per-finding)
   • info            → pass through unvalidated
   Validator sees: the finding + ~20 lines of code around file:line + the relevant rule
   context. Returns { confidence: 0-100, reason: short string }.

7. FILTER — drop findings with confidence < --threshold (default 70).
   Dropped findings are logged to the markdown report in a "filtered" section so the
   user can audit the validator's calibration.

8. RENDER
   • Terminal: severity-grouped summary
   • Markdown: full report saved to .claude/reviews/<branch>-<timestamp>.md
   • PR mode (additionally): single comment posted via `gh pr comment` with file:line
     links using the established `https://github.com/<repo>/blob/<sha>/<file>#L<a>-L<b>`
     format
```

### Halt rule

Only `blocker` severity from the architect halts the downstream pipeline. `major`,
`minor`, and `clean` all let downstream reviewers run; the architect's findings at
those severities are validated and merged into the final report alongside other
agents'.

## Agents

| # | Agent | Lens | Default model |
|---|-------|------|---------------|
| 0 | **Architect** | Approach-level / pattern drift / library misuse / module-boundary violations. Gates pipeline. | Opus |
| 1 | **Conventions** | Project guardrails: no `as` casts, no `unknown`, no non-null `!`, generics stay generic, form components used instead of raw `<input>`, `"use client"` only where needed | Haiku |
| 2 | **World integrity** | In-memory world & tick integrity: JSON-serialization safety (no `Map`/`Set`/`Date`/`Infinity`/`NaN` in `World`), deterministic seeded tick math, atomic tick, the `save-files.ts` dynamic-import guardrail, processors going through the `World` interface + adapter | Sonnet |
| 3 | **Data contract** | Types flowing store/adapter → service → API → hook → component. Guards used only at the boundary. Service-returned types not re-validated downstream. | Sonnet |
| 4 | **Boundary safety** | Zod validation at API/form boundaries, never trusting client state for writes, save-name path safety, no `immutable` cache on APIs, server-only env not leaking to the client bundle | Sonnet |
| 5 | **Silent failures** | Swallowed errors, missing `await`, async callbacks typed as `() => void`, `.sort()` on render, throttle-vs-debounce traps, SSE-driven state without REST seed | Haiku |
| 6 | **User journey (UI/UX)** | Hydration safety, `QueryBoundary` usage, accessibility on actionable elements, loading/error boundaries, navigation flow | Sonnet |
| 7 | **Tests** | Engine/service/processor changes have appropriate Vitest coverage and meaningful assertions. Flags missing coverage. | Sonnet |
| 8 | **Performance** | Expensive per-tick work / peak-latency concentration, missing memoization, expensive renders, viewport-keyed queries causing flicker, Pixi callbacks debounced where throttle is needed | Sonnet |

## Architect severity rubric

**`blocker`** — Apply the fix-simulation test:

1. **Simulate the fix.** What does the diff look like after this finding is addressed?
2. **Downgrade to `major` if:**
   - The fix is "edit one line per affected file" — even across 20 files
   - The fix is contained to a single file, even if that file needs a complete rewrite. Other files in the diff remain sound and reviewable independently.
   - The fix is otherwise localized to a small portion of the diff
3. **Reserve `blocker` for findings meeting BOTH criteria:**
   - **Qualitative**: fix requires *rewriting the approach from scratch* — redesigning the abstraction, restructuring control flow across layers, changing function signatures whose callers cascade
   - **Quantitative**: rework cascades through a substantial portion of the diff. Rule of thumb: ~half the changed files, or roughly 10+ files in a typical PR
4. **If torn between `blocker` and `major`, choose `major`.** False blockers are more expensive than missed blockers — a missed blocker still surfaces in downstream findings, but a false blocker halts the review entirely.

**Example blocker triggers in this codebase:**
- Engine/world code statically imports `fs`/`process.env` in the pure path → restructure behind a dynamic `import()`
- New mutating API route touches the world store inline → extract a service; restructure the handler
- New data-fetching pattern used across many components instead of `useSuspenseQuery + QueryBoundary` → each consumer must be rewritten
- A service returns `Record<string, unknown>` that propagates → fix retypes the service AND rewrites every consumer's destructuring
- Tick processor body reaches into raw world state / an adapter directly → split into World interface + memory adapter + pure body

**Example major (not blocker):**
- 20 `as` casts across files — each is a one-line fix
- One stray static `fs`/`process.env` import in a pure-path module that just needs the dynamic-`import()` escape hatch
- Single hand-rolled utility duplicating one in `lib/utils/`
- Inconsistent error shape in one route

**`major`** — clear bug, contract violation, or convention break, but the fix is localized. Other reviewers proceed.

**`minor`** — nit / cleanup / style note. Doesn't gate anything.

**`info`** — FYI / observation. Passes through without validation.

## Chunking

```
If PR ≤ 20 files:
    ONE CHUNK — entire diff. Done.

If PR > 20 files:
    1. Strip layer prefixes to extract a "feature stem":
         lib/services/ships/buy.ts          → "ships"
         lib/services/ships.ts              → "ships"
         app/api/game/ships/buy/route.ts    → "ships"
         app/(game)/ships/page.tsx          → "ships"
         lib/hooks/use-ships.ts             → "ships"   (drop "use-" prefix)
         components/ships/ship-card.tsx     → "ships"
         lib/engine/ships.ts                → "ships"
         lib/tick/processors/ships.ts       → "ships"
         lib/tick/world/ships.ts            → "ships"

       Recognized layer prefixes:
         lib/services/, lib/hooks/, lib/engine/, lib/tick/processors/,
         lib/tick/world/, lib/tick/adapters/memory/,
         app/api/game/, app/(game)/, components/

    2. Group files by feature stem → semantic clusters.

    3. Target ≤20 files per chunk, but feature cohesion wins:
         • If a cluster is ≤20 → emit as one chunk
         • If a cluster is 21-35 → emit as one chunk; log a "large chunk" notice
         • If a cluster is >35 → split by layer within the feature (engine/services first,
           then api, then UI), keeping each split ≤35

    4. Files not matching any layer prefix (package.json, lib/utils/foo.ts,
       lib/world/save.ts, root configs) → "shared" chunk, capped at 20
       alphabetically if needed.
```

**Architect always sees the full diff**, never chunked. Chunking would defeat its big-picture view.

**Future iteration**: if feature-stem grouping mis-clusters in practice, the next step is import-graph adjacency (group files that import each other). Not built for v1; revisit if real PRs show the heuristic failing.

## Finding schema

Every reviewer emits a JSON array of findings:

```jsonc
{
  "agent": "boundary-safety",                   // identifies the reviewer
  "file": "app/api/game/save/route.ts",         // repo-relative path
  "line": "42-48",                              // single line "42" or range "42-48"
  "category": "missing-zod-validation",         // free-form short slug
  "severity": "major",                          // blocker | major | minor | info
  "message": "POST handler reads the client-supplied save name straight into the file path without a Zod parse; a name like '../foo' escapes the saves directory.",
  "evidence": "L46 passes request body `name` directly to writeSave with no schema parse or path check.",
  "suggested_fix": "Parse the body through saveNameSchema (reject separators / '..' / empty) before building the path."
}
```

**Field rationale:**

- `agent` — kept on findings even after dedup; if multiple agents flagged the same issue, the merged finding lists all co-flaggers.
- `file` + `line` — navigation + dedup key. Line can be a range; for dedup the start line is used.
- `category` — free-form, drives Pass 1 dedup. Conventions agent draws categories from `code-standards.md` for consistency; other agents emit their own.
- `severity` — routes to the right validator (Opus for blocker/major, Haiku for minor) and sorts the final report. The architect uses the rubric above; other agents follow `rules/severity-rubric.md`.
- `message` — what the human reads. 1-2 sentences.
- `evidence` — what the **validator** reads to verify. The single most important field for cutting false positives.
- `suggested_fix` — optional. Present when there's an obvious fix.

**Empty findings:** agents return `[]` when they have nothing. Common and expected.

**Malformed output:** orchestrator validates JSON shape; one retry on parse failure; on second failure that agent's findings for the chunk are skipped with a logged warning. The rest of the pipeline continues.

**Validator output:**

```jsonc
{
  "confidence": 92,   // 0-100
  "reason": "Verified L46 reads buyerId directly with no parse; service layer convention is Zod at boundary."
}
```

## Skip-gate matrix

| Reviewer | Runs when chunk contains... |
|----------|------------------------------|
| Architect | Always (runs once on full PR, not per chunk) |
| Conventions | Any `.ts` / `.tsx` source file; skips docs-only / config-only chunks |
| World integrity | `lib/world/`, `lib/tick/processors/`, `lib/tick/world/`, `lib/tick/adapters/`, `lib/engine/`, `lib/services/` |
| Data contract | Files spanning ≥2 layers from {lib/world, services, tick, app/api, hooks, components, app pages} |
| Boundary safety | `app/api/`, `lib/services/`, `lib/schemas/`, `lib/world/` (save/load), or any `.ts`/`.tsx` source file that reads `process.env`, sets a `Cache-Control` header, or builds a save-file path (grep restricted to source files — markdown/docs that merely describe these do not trigger) |
| Silent failures | Any `.ts` / `.tsx` source file; skips docs-only chunks |
| User journey | `app/(game)/`, `components/` |
| Tests | Source changes in `lib/engine/`, `lib/services/`, `lib/tick/processors/`, `lib/tick/world/`, `lib/tick/adapters/` (regardless of whether matching test files are present) |
| Performance | Any `.ts` / `.tsx` source file; skips docs-only chunks |

**File classification (used by skip-gates):**
- *docs* — `*.md`, `LICENSE`, `*.txt`
- *config* — `package.json`, `package-lock.json`, `tsconfig*.json`, `next.config.*`, `eslint.config.*`, `vitest.config.*`, `prettier.config.*`, `.env.*`, `*.config.{ts,js,mjs}`, `Dockerfile*`, `Makefile`, `*.{yaml,yml}`, `.github/**`, dotfile configs (`.gitignore`, `.gitattributes`, `.dockerignore`, `.editorconfig`, `.npmrc`, `.nvmrc`, `.prettierrc*`, `.eslintrc*`)
- *source* — anything else under `lib/`, `app/`, `components/`, etc.
- *asset* — images (incl. `*.ico`, `*.gif`, `*.avif`), fonts, public assets

A chunk is "docs-only" if every file is *docs*; "config-only" if every file is *config* (or *config* + *docs*).

**Edge cases:**
- Docs-only PR: only architect runs.
- Config-only PR: only architect runs (no source reviewers gate on config).
- UI-only PR: architect + conventions + data contract (if multi-layer) + boundary-safety (if it reads env / sets cache headers) + silent failures + user journey + perf.

The orchestrator logs which reviewers skipped each chunk and why, so the user can audit gating if findings seem missing.

## Output

**Terminal**: severity-grouped summary (blocker → major → minor → info), color-coded if the terminal supports it. Each finding shows file:line, agent(s), category, message in one line. Footer notes the number of validated, filtered, and skipped findings.

**Markdown report**: saved to `.claude/reviews/<branch-or-pr>-<YYYY-MM-DD-HHmmss>.md`. Contains:
1. Header — PR/branch identifier, timestamp, effort level, threshold
2. Architect summary — severity + findings
3. Per-chunk dispatch log — which reviewers ran/skipped, with reasons
4. Findings, grouped by severity, then by file. Each entry shows agent(s), category, message, evidence, suggested_fix, confidence, validator's reason
5. Filtered findings — those below confidence threshold, for audit
6. Stats — total tokens (if measurable), wall time, model usage

The `.claude/reviews/` directory is gitignored.

**PR mode** (additionally): a single `gh pr comment` posted to the PR. Format:

```
### /uber-review (effort: standard)

Architect: <severity>

Found N issues (M filtered):
1. <file:line> <severity> <category> — <message> [<agent(s)>, confidence: <N>]
   <link to file with full sha + L<a>-L<b>>
2. ...
```

No inline per-line comments — too noisy, too slow.

## Skill file layout

```
.claude/skills/uber-review/
├── SKILL.md                    # entry point; orchestration playbook
├── SPEC.md                     # this file
├── prompts/
│   ├── architect.md
│   ├── conventions.md
│   ├── world-integrity.md
│   ├── data-contract.md
│   ├── boundary-safety.md
│   ├── silent-failures.md
│   ├── user-journey.md
│   ├── tests.md
│   ├── performance.md
│   └── validator.md           # shared validator prompt (parameterized by severity tier)
└── rules/
    ├── code-standards.md       # dedup-slug catalog + flagging nuance (review projection of CLAUDE.md)
    └── severity-rubric.md      # shared severity scale (other agents reference this)
```

**Why ship the skill in-repo (committed):**
- Standards evolve with the codebase. When a new convention or gotcha is discovered (e.g., `Cache-Control: immutable` on APIs is bad), it lands in `CLAUDE.md` (the canonical source the orchestrator injects), and its dedup slug lands in `code-standards.md` — both alongside the fix.
- Other contributors get the skill automatically when they pull.
- The skill's prompts reference concrete patterns from this codebase; they belong with the codebase.

`.claude/skills/uber-review/` is tracked by git as-is (current `.gitignore` only excludes `.claude/settings.local.json` and `.claude/worktrees/`). `.claude/reviews/` will be added to `.gitignore` during implementation so review output stays local while the skill itself is committed.

## Error handling and edge cases

- **No diff** (branch is at main): exit early with "nothing to review".
- **PR doesn't exist / closed / draft**: exit early with a clear message. `gh pr view <#>` is the eligibility check.
- **Agent returns malformed JSON**: one retry with schema spelled out; on second failure, skip that agent for the chunk with a logged warning.
- **Agent times out**: skip with logged warning. Pipeline continues.
- **Architect returns malformed severity**: treat as `clean` (don't halt on garbage); log the failure.
- **All reviewers skip a chunk** (e.g., chunk is pure docs): chunk is logged as "no applicable reviewers" and the pipeline continues.
- **Dedup Pass 2 ambiguity**: if Haiku returns malformed merge-decision, default to "no merge" (keep both findings). Safe default.

