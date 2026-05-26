# /uber-review Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/uber-review` skill — a project-local multi-agent code review pipeline orchestrated by markdown playbooks and the `Agent` tool. End state: invoking `/uber-review` (with or without a PR number) produces a deduped, validated, severity-ranked review report from a team of nine specialized reviewers.

**Architecture:** This is a **prompt-driven skill**, not a code module. There is no TypeScript/Python to compile or test. The "implementation" is a set of markdown files (`SKILL.md` + per-agent prompts + shared rule files) that Claude reads at runtime and follows to orchestrate sub-agent reviews via the `Agent` tool. All orchestration logic (file classification, chunking, dedup, validation routing, output rendering) is executed by Claude reading the playbook and using its tools — `Bash` for diff/git/gh, `Agent` for sub-agent dispatch, `Read`/`Write` for file I/O.

**Tech Stack:** Markdown for prompts and rules; `Agent` tool with model overrides (`opus` / `sonnet` / `haiku`); `Bash` for `git diff` / `gh pr diff` / `gh pr comment`; project conventions from `CLAUDE.md`.

---

## Resolved deferred questions (from SPEC.md)

The spec deferred six implementation questions. Decisions used by this plan:

1. **Sub-agent dispatch** — Use the `Agent` tool with `subagent_type: "general-purpose"` and an explicit `model` override per the effort table. Each reviewer is dispatched as a single Agent call; multiple reviewers per chunk go out as parallel Agent calls in one message.

2. **JSON output handling** — Agents are instructed to emit findings wrapped in a ` ```json ` fenced block and nothing else. Orchestrator extracts via regex `/```json\s*([\s\S]*?)\s*```/`, then `JSON.parse`. On parse failure: one retry with a sharpened "return ONLY a JSON array, no other text" prompt. On second failure: skip with logged warning.

3. **File classification** — Pure path-pattern matching, done by Claude as part of orchestration reasoning (no LLM call, no script). Rules live inline in `SKILL.md` as a classification table.

4. **Markdown report format** — Concrete template in PR 1 (Task 1.6) and PR 3 (Task 3.4). Headings, tables, code excerpts, severity grouping.

5. **gh commands** — `gh pr view <#> --json state,isDraft,number,headRefName,headRefOid,baseRefName,headRepository` for eligibility + sha; `gh pr diff <#>` for the diff; `gh pr comment <#> --body-file <path>` for posting; permalink format uses `headRefOid` for full sha.

6. **Token/cost accounting** — Deferred to a v2 iteration. `Agent` tool returns text output but does not directly expose token counts in a stable form. Not blocking for v1.

---

## PR breakdown

Three PRs, each end-to-end working at increasing capability. Worktrees per PR per the project's workflow preference (commit in worktree → cherry-pick → delete worktree → review between PRs).

- **PR 1** — Foundation: end-to-end pipeline with **architect only**. Single chunk, no skip-gates, validator pass. Proves the dispatch + parse + render path works.
- **PR 2** — Reviewer team: add the other eight reviewers, skip-gate matrix, file classification, deterministic dedup (Pass 1), Haiku fuzzy dedup (Pass 2), tiered validation routing.
- **PR 3** — Polish: chunker for large PRs (>20 files), PR mode (`gh pr comment` with permalinks), spec cleanup, final end-to-end verification.

---

# PR 1 — Foundation: Architect-only pipeline

End state: `/uber-review` works against a local branch. It fetches the diff, dispatches the architect (Opus), parses its findings, runs the validator, and renders a terminal + markdown report. No other reviewers yet. This proves out the dispatch / parse / validate / render skeleton end-to-end before adding the rest of the team.

## Task 1.1: Add `.claude/reviews/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Read the current gitignore**

Read `.gitignore` to confirm current `.claude/` rules.

- [ ] **Step 2: Add the reviews directory exclusion**

Edit `.gitignore`. Find the block:

```
# claude local settings
.claude/settings.local.json
.claude/worktrees/
```

Replace with:

```
# claude local settings
.claude/settings.local.json
.claude/worktrees/
.claude/reviews/
```

- [ ] **Step 3: Verify**

Run: `mkdir -p .claude/reviews; touch .claude/reviews/test.md; git status --short`
Expected: `.claude/reviews/test.md` does NOT appear (ignored).
Cleanup: `rm .claude/reviews/test.md`

- [ ] **Step 4: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore .claude/reviews/ for uber-review output"
```

---

## Task 1.2: Create `rules/severity-rubric.md`

The severity scale shared by non-architect agents. The architect uses its own halt rubric (inline in its prompt).

**Files:**
- Create: `.claude/skills/uber-review/rules/severity-rubric.md`

- [ ] **Step 1: Create the file**

Write the following exact content to `.claude/skills/uber-review/rules/severity-rubric.md`:

```markdown
# Severity rubric (non-architect agents)

When emitting findings, assign one of these severities. The architect has its own rubric — these definitions apply to every other reviewer.

## `blocker`

A clear correctness bug or contract violation whose fix requires **substantial rework**. Reserve this for issues that would invalidate the PR's approach. If the fix is a one-line edit per file, downgrade to `major`. If the fix is contained to a single file, downgrade to `major`.

Examples:
- A service silently swallows errors that the caller needs to see (callers all need updating)
- An auth gate is missing on a mutating route that creates user data
- A type signature is so wrong that consumers crash at runtime

## `major`

A clear bug, contract violation, or convention break that has a **localized** fix. Other reviewers can still meaningfully review the rest of the diff.

Examples:
- Missing Zod validation at an API boundary
- A service returns `Record<string, unknown>` (violates project's no-`unknown` rule)
- An `as` cast where the type can be fixed at the source
- A `Cache-Control: immutable` header on an API endpoint
- A `.sort()` called during render on a state array

## `minor`

A nit, cleanup, or stylistic point. Doesn't gate anything. The reviewer is noting it for awareness or future refactoring.

Examples:
- Function could be extracted to `lib/utils/` for reuse
- Naming inconsistency with a sibling file
- A `useMemo` could be added but the cost is not yet high

## `info`

An observation worth surfacing but not actionable on its own. Passes through without confidence validation.

Examples:
- "This file now exceeds 300 lines; consider splitting in a future PR"
- "This pattern matches a known good idiom — flagged as a positive signal"

## Bias toward lower severity when uncertain

If torn between two levels, choose the lower. False high-severity findings erode reviewer trust and waste validator budget.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/rules/severity-rubric.md
git commit -m "feat(uber-review): severity rubric for non-architect agents"
```

---

## Task 1.3: Create `rules/code-standards.md`

The forbidden-patterns checklist used by the Conventions agent (added in PR 2 — but the file lives here from PR 1 so the orchestrator can reference it, and so the rule list ships independently of any one agent's prompt).

**Files:**
- Create: `.claude/skills/uber-review/rules/code-standards.md`

- [ ] **Step 1: Create the file**

Write the following exact content:

```markdown
# Project code standards (forbidden patterns)

Patterns explicitly forbidden by `CLAUDE.md`. The Conventions agent uses this as its checklist; other agents may reference it too. When flagging a violation, use the suggested category slug for dedup consistency.

## Type safety

- **No `as` casts** — category: `as-cast`
  - Only `as const` and casts inside runtime guards in `lib/types/guards.ts` are permitted.
  - Any other `as Foo` is a violation.

- **No non-null assertion `!`** — category: `non-null-assertion`
  - Force-unwrapping with `!` silences rather than fixes the type at source.
  - Exception: only in narrow contexts where a runtime check immediately precedes (rare and worth scrutiny).

- **No `unknown` in the codebase** — category: `unknown-in-types`
  - `Record<string, unknown>`, `unknown`, and untyped maps/arrays are banned in components, hooks, services, processors, engine, constants.
  - Only exception: `JSON.parse` result at a system boundary (API route, sessionStorage) — must be narrowed via `typeof`/`in` immediately, never stored as `unknown`.

- **Generics must stay generic** — category: `generic-widened`
  - `DataTable<T>` and similar must work with `T` directly.
  - Never intersect `T` with `Record<string, unknown>` or widen to weaken type safety.
  - Use typed accessor functions (`render(row: T)`, `getValue(row: T)`) over string-key property access.

## API & data flow

- **Validate at boundaries only** — category: `boundary-validation-leak`
  - Prisma returns strings for union fields; validate once in the service layer using `lib/types/guards.ts`.
  - Components, hooks, processors never re-validate types that were already validated upstream.

- **Mutation services return discriminated unions** — category: `loose-mutation-result`
  - Pattern: `{ ok: true; data } | { ok: false; error }`.
  - Never `{ ok: boolean; data?; error? }`.

- **API responses use `ApiResponse<T>`** — category: `api-response-shape`
  - Shape: `{ data?: T, error?: string }`.

## UI

- **Use existing form components, never raw `<input>` / `<select>`** — category: `raw-form-element`
  - `TextInput`, `NumberInput`, `RangeInput`, `SelectInput` from `components/form/`.

- **`"use client"` only when needed** — category: `unnecessary-use-client`
  - Components without hooks, state, or event handlers don't need it.

- **No `.sort()` on state arrays during render** — category: `sort-mutates-state`
  - Use `[...arr].sort()` or `.toSorted()`.

- **Data fetching uses `useSuspenseQuery` + `QueryBoundary`** — category: `non-suspense-data-fetch`
  - Deviations are architect-level.

## Server / DB

- **TOCTOU in mutating routes** — category: `toctou-outside-tx`
  - Re-read state inside `prisma.$transaction` before writing.
  - Never compute new values from a pre-transaction snapshot.
  - Use `{ increment }` for atomic numeric updates.

- **Prisma 7 driver adapter required** — category: `missing-driver-adapter`
  - `new PrismaClient()` without an adapter throws.

- **PostgreSQL transaction timeout** — category: `missing-tx-timeout`
  - Default 5000ms; set `{ timeout: 30_000 }` on `$transaction()`.

- **Auth-gated routes use `Cache-Control: private`** — category: `cache-public-on-auth-route`
  - Never `public` on routes behind `requirePlayer()`.

- **Never `Cache-Control: immutable` on APIs** — category: `immutable-on-api`
  - For static assets only.

## Async correctness

- **Await async callbacks** — category: `unawaited-async-callback`
  - If a parent passes an async callback, the child must `await` it.
  - Prop types should be `() => Promise<void>` not `() => void` when the callback is async.

- **SSE hooks seed initial state via REST** — category: `sse-without-seed`
  - Otherwise components see stale defaults until first SSE event.

- **Throttle (not debounce) for high-frequency render loops** — category: `debounce-in-render-loop`
  - Pixi ticker etc.

## Maintenance note

This list grows. When a new project convention is discovered, add it here in the next PR alongside the fix. Categories are slugs for deterministic dedup — keep them lowercase-kebab-case and short.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/rules/code-standards.md
git commit -m "feat(uber-review): code-standards rule reference"
```

---

## Task 1.4: Create `prompts/architect.md`

The architect agent prompt. Contains the halt rubric inline (no separate `halt-rubric.md` file — only architect needs it).

**Files:**
- Create: `.claude/skills/uber-review/prompts/architect.md`

- [ ] **Step 1: Create the file**

Write the following exact content:

```markdown
# Architect reviewer prompt

You are the architect reviewer in a multi-agent code review pipeline. You run first. Your decision determines whether the rest of the pipeline runs.

## Your lens

You look for **approach-level** problems — issues whose fix requires rewriting how something is done, not patching a line. Specifically:

- **Pattern drift** — a new approach that contradicts an established one in the codebase (e.g., a new data-fetching path that isn't `useSuspenseQuery + QueryBoundary`; a new form that isn't `components/form/` + RHF + Zod)
- **Library / framework misuse** — hand-rolled solutions where the project's stack has an idiom (e.g., custom client cache when TanStack Query is the standard; raw `<dialog>` handling when `components/ui/dialog.tsx` exists; custom retry logic when the existing pattern handles it)
- **Module-boundary violations** — code crossing the layered architecture lines:
  - `lib/engine/` must be pure — no DB imports
  - `lib/tick/processors/` must access DB only through the `World` interface + adapter, never Prisma directly
  - `lib/services/` is where DB and business logic live; route handlers (`app/api/`) are thin wrappers
- **Type-safety bypass at scale** — `unknown`, `Record<string, unknown>`, or broad `as` casts proliferating through service returns
- **Missing critical abstraction** — e.g., a new mutating route without a service layer

You do **not** catch line-level bugs, missing Zod, single-file conventions, or N+1 queries. Other reviewers handle those.

## Severity rubric — apply this for every finding

### `blocker` — pipeline halts. Apply the fix-simulation test:

1. **Simulate the fix.** What does the diff look like *after* this finding is addressed?
2. **Downgrade to `major` if:**
   - The fix is "edit one line per affected file" — even across 20 files
   - The fix is contained to a single file, even if that file needs a complete rewrite. Other files in the diff remain sound and reviewable independently.
   - The fix is otherwise localized to a small portion of the diff
3. **Reserve `blocker` for findings meeting BOTH criteria:**
   - **Qualitative**: fix requires *rewriting the approach from scratch* — redesigning the abstraction, restructuring control flow across layers, changing function signatures whose callers cascade
   - **Quantitative**: rework cascades through a substantial portion of the diff. Rule of thumb: ~half the changed files, or roughly 10+ files in a typical PR. Even a complete rewrite of one file while 19 others are sound is **not** a blocker.
4. **If torn between `blocker` and `major`, choose `major`.** False blockers are more expensive than missed blockers — a missed blocker still surfaces in downstream findings, but a false blocker halts the review entirely.

### `major` — pipeline continues; finding goes into the pool

Clear architectural drift but localized:
- 20 `as` casts across files — each is a one-line fix
- One stray Prisma import in a processor that just needs the existing adapter path
- Single hand-rolled utility duplicating one in `lib/utils/`
- Inconsistent error shape in one route

### `minor` — nit / cleanup / style note. Doesn't gate anything.

### `info` — FYI / observation. Passes through without validation.

## Output

Return ONLY a JSON object wrapped in a ```json fenced block. Nothing else — no preamble, no commentary.

Schema:

```json
{
  "severity": "blocker | major | minor | clean",
  "findings": [
    {
      "agent": "architect",
      "file": "lib/services/ships.ts",
      "line": "42-48",
      "category": "module-boundary-violation",
      "severity": "blocker | major | minor | info",
      "message": "1-2 sentence description",
      "evidence": "concrete code/diff snippet or reasoning anchoring the finding",
      "suggested_fix": "optional"
    }
  ]
}
```

- `severity` at the top level is your overall verdict — the pipeline halts only if it's `blocker`.
- If you have no findings, return `{ "severity": "clean", "findings": [] }`.
- `findings` may include `blocker`/`major`/`minor`/`info` items even when top-level severity is `clean` (your overall verdict may be benign even with notes).
- The top-level `severity` should equal the **highest** severity present in `findings` (or `clean` if empty).

## Context you receive

You will be given:
- The full PR diff (unified format)
- A brief summary of the change (branch name, file list)
- The project's `CLAUDE.md` is your authoritative reference for layering, conventions, and established patterns

You will NOT be given the per-file code outside the diff. If you need to reason about how a changed file fits into the broader architecture, infer from imports, file paths, and the diff context alone.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/architect.md
git commit -m "feat(uber-review): architect agent prompt with halt rubric"
```

---

## Task 1.5: Create `prompts/validator.md`

The shared validator prompt. Reused for blocker/major (dispatched on Opus) and minor (dispatched on Haiku) findings.

**Files:**
- Create: `.claude/skills/uber-review/prompts/validator.md`

- [ ] **Step 1: Create the file**

Write the following exact content:

```markdown
# Validator prompt

You are validating a single code review finding produced by an upstream reviewer agent. Your job is to score how likely the finding is real, on a 0-100 confidence scale.

## What you receive

- The finding (file, line, category, severity, message, evidence, suggested_fix)
- ~20 lines of code centered on the cited line (already extracted for you)
- The rule context (e.g., the project convention this finding cites, if any)
- The project's `CLAUDE.md` is your authoritative reference

## What you do

Read the finding's `evidence` and check it against the code. Ask:

1. Does the cited line actually contain what the reviewer claims?
2. Is the reasoning correct in context (not a misread of the diff)?
3. If it cites a project convention, is that convention actually in `CLAUDE.md` or `rules/code-standards.md`?
4. Could this be a false positive due to:
   - Pre-existing code the reviewer mistook for new
   - A pattern that's explicitly silenced elsewhere
   - A convention that doesn't apply to this layer
   - Reasoning the reviewer applied that doesn't fit the actual call site

## Confidence scale

- **0** — Clearly a false positive. The cited line does not contain what the reviewer claims, or the reasoning is plainly wrong.
- **25** — Possibly real, but the reviewer's evidence is weak. The finding might be a misread.
- **50** — The finding has some merit but is borderline — could be a nit, could be a real issue. Reviewer's evidence is partial.
- **75** — Verified real. The cited line matches the description; the reasoning holds in context.
- **100** — Definitively real. The evidence is concrete, the violation is unambiguous, and the convention (if cited) is in the project rules.

## Output

Return ONLY a JSON object wrapped in a ```json fenced block. Nothing else.

```json
{
  "confidence": 92,
  "reason": "one-sentence explanation of your call"
}
```

## Bias

When uncertain, **prefer lower confidence**. The pipeline's threshold (default 70) filters low-confidence findings out — this protects against noise. False-positive findings that survive validation erode trust in the whole pipeline.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/validator.md
git commit -m "feat(uber-review): shared validator prompt with confidence rubric"
```

---

## Task 1.6: Create `SKILL.md` — orchestration playbook (architect-only path)

The entry-point skill file. At this PR, it only knows how to run the architect; the rest is added in PR 2 and PR 3. The skill is invokable as `/uber-review` once present in `.claude/skills/`.

**Files:**
- Create: `.claude/skills/uber-review/SKILL.md`

- [ ] **Step 1: Create the file**

Write the following exact content:

````markdown
---
name: uber-review
description: Multi-agent code review of a local branch or GitHub PR. Use when the user runs /uber-review (with or without a PR number) and wants a thorough team-style review.
---

# /uber-review — Multi-agent code review

You are orchestrating a team of specialized reviewer sub-agents to review a code change. This file is your playbook — follow it step by step. Per-agent prompts and shared rules live next to this file in `prompts/` and `rules/`.

## Inputs

Parse the user's command for these flags:

- Positional `<PR#>` (optional integer) — if present, **PR mode**; otherwise **local mode** (current branch vs `main`).
- `--effort=quick|standard|deep` — default `standard`.
- `--only=<comma-separated>` — restrict to listed reviewers. Names: `architect`, `conventions`, `db-integrity`, `data-contract`, `security`, `silent-failures`, `user-journey`, `tests`, `performance`.
- `--skip-architect` — skip the gating pass.
- `--threshold=<N>` — confidence floor for inclusion (default 70).
- `--chunk-size=<N>` — target chunk size (default 20).

## Effort dial

| Effort | Architect | Reasoning reviewers | Mechanical reviewers |
|--------|-----------|---------------------|----------------------|
| `quick` | sonnet | haiku | haiku |
| `standard` (default) | opus | sonnet | haiku |
| `deep` | opus | sonnet (+ opus for data-contract & security) | haiku |

Reasoning reviewers: db-integrity, data-contract, security, user-journey, tests, performance.
Mechanical reviewers: conventions, silent-failures.

## Pipeline (PR 1 scope: architect only)

### 1. Fetch the diff and metadata

**Local mode:**
- Bash: `git diff main...HEAD` (unified diff). Save to a temp file or hold in memory.
- Bash: `git rev-parse HEAD` for the head sha.
- Bash: `git branch --show-current` for the branch name.
- Bash: `git diff main...HEAD --name-only` for the file list.
- If diff is empty, exit early: "Nothing to review — branch matches main."

**PR mode:**
- Bash: `gh pr view <#> --json state,isDraft,number,headRefName,headRefOid,baseRefName,headRepository`
- Eligibility check: if `state != "OPEN"` or `isDraft == true`, exit with a clear message.
- Bash: `gh pr diff <#>` for the diff.
- Use `headRefOid` as the sha and `headRefName` as the branch.
- Use `headRepository.nameWithOwner` for permalink format (PR mode output, added in PR 3).

### 2. Dispatch the architect

Skip this section if `--skip-architect` is set; jump to step 5 with severity `clean`.

Read `prompts/architect.md`. Construct the architect's prompt:

```
<contents of prompts/architect.md>

---

## Change summary

Branch: <branch-name>
Files changed (<count>):
<file list, one per line, with +<adds>/-<dels> per file from `git diff --stat`>

## Diff

<full unified diff>
```

Dispatch via the `Agent` tool:

- `description`: "Architect review"
- `subagent_type`: `general-purpose`
- `model`: depends on effort — `opus` for `standard`/`deep`, `sonnet` for `quick`
- `prompt`: the constructed prompt above

### 3. Parse architect output

The architect returns a string. Extract the JSON via regex `/```json\s*([\s\S]*?)\s*```/`. Parse with `JSON.parse`.

If the fenced block is missing or JSON parse fails:
- **Retry once** with a sharpened follow-up: dispatch the same Agent again, but append to the prompt: "Your previous response was malformed. Return ONLY a JSON object in a ```json fenced block. No other text."
- If second attempt also fails, treat the architect's severity as `clean` and record a warning in the report. Do not halt the pipeline.

Validate shape:
- `severity` ∈ {`blocker`, `major`, `minor`, `clean`}
- `findings` is an array (possibly empty)
- Each finding has all required fields (`agent`, `file`, `line`, `category`, `severity`, `message`, `evidence`)

If `severity` is not one of the four valid values, treat as `clean` + warning.

### 4. Apply the halt rule

If architect `severity == "blocker"`:
- Skip downstream reviewers entirely (PR 2 logic).
- Proceed directly to step 5 (validate architect's findings, then render).
- Report header will note: "Pipeline halted by architect (blocker severity)."

Otherwise:
- Architect's findings join the pool. PR 2 will add downstream reviewers; in PR 1 the pool is just architect's findings.

### 5. Validate findings (tiered)

For each finding in the pool:

- If `severity ∈ {blocker, major}` → dispatch a validator on **opus**
- If `severity == minor` → dispatch a validator on **haiku**
- If `severity == info` → pass through with `confidence: 100, reason: "info, not validated"`

Validator dispatch (one Agent call per finding):

- `description`: "Validate finding"
- `subagent_type`: `general-purpose`
- `model`: per the tier above
- `prompt`: contents of `prompts/validator.md` + the finding (JSON) + ~20 lines of code from the cited file (read via `Read` tool around the cited line) + any relevant rule context (e.g., if `category` matches an entry in `rules/code-standards.md`, include that section)

Parallel dispatch is fine — send all validator calls in one Agent batch.

Parse each validator's JSON output (same fenced-block extraction). On parse failure, default to `{ confidence: 0, reason: "validator output malformed" }` — this filters the finding out.

### 6. Filter

Drop findings with `confidence < <threshold>` (default 70).
Keep `info` findings regardless (they passed through with 100).
Record filtered findings separately for the audit section of the markdown report.

### 7. Render

#### Terminal output

Print a severity-grouped summary. Format:

```
/uber-review (effort: <effort>, threshold: <N>)
<branch-or-PR> · <N> reviewers ran · <N> findings (<M> filtered)

Architect: <severity>

▶ BLOCKER (<count>)
  <file>:<line>  <category>  <message>  [<agent>, conf <N>]
▶ MAJOR (<count>)
  ...
▶ MINOR (<count>)
  ...
▶ INFO (<count>)
  ...

Full report: .claude/reviews/<filename>.md
```

If `blocker` halted the pipeline, prepend: `⚠ Pipeline halted by architect.`

#### Markdown report

Save to `.claude/reviews/<branch-or-PR>-<YYYY-MM-DD-HHmmss>.md`. (Create `.claude/reviews/` if missing — it's gitignored.) Template:

```markdown
# /uber-review — <branch-or-PR>

- **Timestamp**: <ISO timestamp>
- **Effort**: <effort>
- **Threshold**: <N>
- **Mode**: local | PR #<N>
- **Files changed**: <N>

## Architect

**Severity**: <severity>

<if halted, a note>

### Architect findings

<for each architect finding>
- **<file>:<line>** — <category> · <severity> · confidence <N>
  > <message>
  
  Evidence: <evidence>
  
  Suggested fix: <suggested_fix or "—">
  
  Validator: <reason>

## Findings by severity

<grouped: blocker → major → minor → info>
<for each, same format as architect findings above>

## Filtered findings (confidence < threshold)

<same format; collapsed for audit>

## Reviewer dispatch log

(PR 2 will populate this with per-chunk dispatch decisions.)
```

### 8. (PR 3) PR mode comment

Not yet implemented. PR 3 adds `gh pr comment` posting.

## Error handling

- **No diff**: exit early with a friendly message.
- **PR closed/draft**: exit early.
- **Agent malformed output**: one retry; if still bad, skip with warning.
- **Architect severity malformed**: treat as `clean` + warning.

## What's NOT in PR 1

These are added in PR 2 and PR 3:
- Other reviewer agents (conventions, db-integrity, data-contract, security, silent-failures, user-journey, tests, performance)
- File classification and skip-gate matrix
- Chunking for large PRs
- Dedup (Pass 1 deterministic + Pass 2 Haiku fuzzy)
- PR mode comment posting
- `--only` filter behavior (PR 1 only knows architect)
````

- [ ] **Step 2: Verify the file is well-formed**

Open the file in an editor or use `Read` to confirm the YAML frontmatter parses (single `---` block at top) and the markdown structure is intact.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/uber-review/SKILL.md
git commit -m "feat(uber-review): orchestration playbook (PR 1 — architect-only path)"
```

---

## Task 1.7: End-to-end verification on a local branch

Manual verification — the skill is invokable and the architect-only pipeline works.

- [ ] **Step 1: Reload skills**

If running in Claude Code interactively, the skill should be picked up automatically once the files exist under `.claude/skills/uber-review/`. Restart the Claude Code session if it doesn't appear in `/skills`.

- [ ] **Step 2: Create a deliberate test branch**

```bash
git checkout -b test/uber-review-pr1
echo "// test change" >> lib/utils/numbers.ts
git add lib/utils/numbers.ts
git commit -m "test: trivial change for uber-review verification"
```

- [ ] **Step 3: Invoke the skill**

Run: `/uber-review`

Expected behavior:
- Skill fetches the diff via `git diff main...HEAD`
- Dispatches architect (model: opus) with the diff
- Architect returns `severity: "clean"` (trivial change, no concerns) or possibly a `minor` (e.g., "comment-only diff has no purpose")
- Validator runs on any findings
- Terminal summary printed
- Markdown report written to `.claude/reviews/test_uber-review-pr1-*.md`

If architect returns `blocker` on this trivial change, the prompt is mis-calibrated — iterate on `prompts/architect.md`.

- [ ] **Step 4: Inspect the report**

Read the saved markdown report. Confirm:
- Header has correct metadata
- Architect section is populated
- If any findings, evidence and validator reason are present
- Filtered section exists (possibly empty)

- [ ] **Step 5: Create a deliberate blocker scenario** *(optional but valuable)*

Make a change that should trigger an architect blocker — e.g., add a Prisma import to `lib/engine/economy.ts`:

```bash
# (only as a test — revert after)
echo "import { prisma } from '@/lib/prisma';" >> lib/engine/economy.ts
git add lib/engine/economy.ts
git commit -m "test: deliberate engine-imports-prisma violation"
```

Run `/uber-review` again. Expected:
- Architect returns `severity: "blocker"` with a finding citing `lib/engine/economy.ts`
- Terminal output is prepended with `⚠ Pipeline halted by architect.`
- Markdown report notes halt

Revert the test change: `git reset --hard HEAD~1` (or delete the branch).

- [ ] **Step 6: Cleanup and commit verification notes**

If you found issues with prompts during verification, fix them in `prompts/architect.md` or `prompts/validator.md` and commit. Otherwise nothing more to commit.

Delete the test branch: `git checkout main && git branch -D test/uber-review-pr1`.

---

# PR 2 — Reviewer team, skip-gates, dedup

End state: the full team of nine reviewers is wired up. Each reviewer has its own prompt. The orchestrator classifies files, dispatches matching reviewers in parallel (one chunk only — PRs >20 files still go through as one chunk in this PR; PR 3 adds chunking). Findings are deduped deterministically (Pass 1) and via Haiku fuzzy merge (Pass 2). Tiered validation runs as before.

## Task 2.1: Create `prompts/conventions.md`

The mechanical-reviewer prompt for code-standards violations. References `rules/code-standards.md` (which is injected into the prompt at dispatch time).

**Files:**
- Create: `.claude/skills/uber-review/prompts/conventions.md`

- [ ] **Step 1: Create the file**

```markdown
# Conventions reviewer prompt

You are the conventions reviewer in a multi-agent code review pipeline. You enforce mechanical project rules — patterns that are either present or not. You don't reason about architecture, security, or business logic.

## Your lens

Scan the diff for violations of the project conventions listed below (loaded from `rules/code-standards.md`). Use the suggested category slug for each finding so dedup is deterministic.

## What you receive

- The diff (unified format) for one chunk
- The contents of `rules/code-standards.md` — your checklist
- The severity rubric from `rules/severity-rubric.md`

## What you flag

For each violation: emit one finding. Most convention violations are `major` (clear rule break, localized fix). Some are `minor` (style nits). Use your judgment per the severity rubric.

You do NOT flag:
- Issues already silenced by inline comments
- Pre-existing code (only changed lines)
- Things outside `rules/code-standards.md`'s scope — that's other agents' jobs

## Output

Return ONLY a JSON array wrapped in a ```json fenced block. Nothing else.

```json
[
  {
    "agent": "conventions",
    "file": "<path>",
    "line": "<n or n-m>",
    "category": "<slug from code-standards.md>",
    "severity": "major | minor",
    "message": "<1-2 sentences>",
    "evidence": "<the offending snippet or specific line content>",
    "suggested_fix": "<concrete fix or omit>"
  }
]
```

If no violations: return `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/conventions.md
git commit -m "feat(uber-review): conventions reviewer prompt"
```

---

## Task 2.2: Create `prompts/silent-failures.md`

**Files:**
- Create: `.claude/skills/uber-review/prompts/silent-failures.md`

- [ ] **Step 1: Create the file**

```markdown
# Silent failures reviewer prompt

You are the silent-failures reviewer in a multi-agent code review pipeline. You catch bugs that don't crash — code that silently does the wrong thing.

## Your lens

You look for:

- **Swallowed errors** — `try/catch` blocks that catch and discard, or log without re-throwing where the caller needs to know
- **Missing `await`** — calling an async function without `await`, especially in:
  - Event handlers (`onClick={async () => somethingAsync()}` instead of `await somethingAsync()`)
  - Form submit callbacks where the parent expects completion
  - Async setup in `useEffect` without proper cleanup
- **Async callbacks typed as `() => void`** — when the prop is async, the type must be `() => Promise<void>` so consumers know to `await`
- **`.sort()` called on a state array during render** — mutates, causes silent wrong-order bugs. Use `[...arr].sort()` or `.toSorted()`.
- **SSE hooks without REST seed** — components see stale defaults until first SSE event. Fix: fetch initial state from a REST endpoint on mount.
- **Throttle vs debounce traps** — `setState` from a 60fps render loop should use leading+trailing throttle, not debounce. Debounce never fires during continuous activity.
- **Race conditions in mutating routes** (TOCTOU) — reading state outside `prisma.$transaction` and writing inside. Should re-read inside the transaction.

## Suggested category slugs

- `swallowed-error`
- `missing-await`
- `async-as-void-prop`
- `sort-mutates-state`
- `sse-without-seed`
- `debounce-in-render-loop`
- `toctou-outside-tx`

## Severity

Most silent failures are `major` (clear bug). A `.sort()` call in dead code path might be `minor`. Race conditions in mutating routes are `blocker` (correctness issue affecting user data).

## Output

Same JSON-array-in-fenced-block schema as other reviewers. Required fields: `agent` ("silent-failures"), `file`, `line`, `category`, `severity`, `message`, `evidence`. Optional: `suggested_fix`.

If no findings: `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/silent-failures.md
git commit -m "feat(uber-review): silent-failures reviewer prompt"
```

---

## Task 2.3: Create `prompts/db-integrity.md`

**Files:**
- Create: `.claude/skills/uber-review/prompts/db-integrity.md`

- [ ] **Step 1: Create the file**

```markdown
# Database integrity reviewer prompt

You are the database integrity reviewer. You focus on Prisma usage, transactional correctness, and PostgreSQL-specific gotchas in this codebase.

## Your lens

You look for:

- **TOCTOU in mutating routes** — re-read inside `prisma.$transaction` before writing. Don't compute new values from a pre-transaction snapshot. Use `{ increment }` for atomic numeric updates. — category: `toctou-outside-tx`
- **Missing optimistic locking** in mutations that read-modify-write — category: `missing-optimistic-lock`
- **N+1 inside `$transaction`** — loops doing `create`/`update`/`findMany` per iteration. Should batch via `createMany`, `createManyAndReturn`, or `unnest()` UPDATE. — category: `n-plus-one-in-tx`
- **Missing PostgreSQL transaction timeout** — default 5000ms, must set `{ timeout: 30_000 }` on `$transaction()` for non-trivial work. — category: `missing-tx-timeout`
- **Prisma 7 driver adapter missing** — `new PrismaClient()` without an adapter throws. — category: `missing-driver-adapter`
- **`NaN`/`Infinity` passed to raw SQL** — PostgreSQL rejects, aborts the transaction. Guard before `$queryRaw`/`$executeRaw`. — category: `unguarded-nan-infinity`
- **Error swallowing inside `$transaction`** — PostgreSQL aborts the transaction on any query error; you can't swallow and continue. Must re-throw. — category: `swallowed-error-in-tx`
- **Schema migrations without rollback consideration** — flag if a migration changes column types or drops columns. — category: `risky-migration`

## Severity

- TOCTOU and N+1 in tx → `major` typically; `blocker` if pervasive (e.g., a new transactional service-wide pattern is N+1 by design)
- Missing tx timeout → `major`
- Driver adapter missing → `major`
- Migration risks → `major` with a note

## Output

JSON array wrapped in ```json fenced block. `agent`: "db-integrity". Required fields as in other reviewers.

If no findings: `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/db-integrity.md
git commit -m "feat(uber-review): db-integrity reviewer prompt"
```

---

## Task 2.4: Create `prompts/data-contract.md`

**Files:**
- Create: `.claude/skills/uber-review/prompts/data-contract.md`

- [ ] **Step 1: Create the file**

```markdown
# Data contract reviewer prompt

You are the data contract reviewer. You trace types as they flow through the layered architecture: DB → service → API → hook → component.

## Your lens

The project's contract:

- **Types validated at the boundary, trusted downstream** — Prisma returns strings for union fields; services validate once using `lib/types/guards.ts` and return fully typed data. Components, hooks, processors never re-validate.
- **Services return discriminated unions for mutations** — `{ ok: true; data } | { ok: false; error }`, never `{ ok: boolean; data?; error? }`.
- **API responses use `ApiResponse<T>`** — `{ data?: T, error?: string }`.
- **No `unknown` in the codebase** — Banned in components, hooks, services, processors, engine, constants. Only allowed at `JSON.parse` boundaries, narrowed immediately via `typeof`/`in`. Never stored as `unknown`.
- **No `as` casts** — only `as const` and inside type guards.
- **Generics stay generic** — `DataTable<T>` works with `T` directly; never intersect with `Record<string, unknown>` or widen.

You look for:

- A service returning an over-narrow or over-loose type (e.g., `string` where a union exists; `Record<string, unknown>` instead of a typed map)
- A component re-validating data that came from a typed service (means the service's type is wrong)
- A type guard called downstream of a service that already narrowed
- A hook losing type information by widening its return
- Prisma `where` clause typed loosely (`unknown` instead of `Prisma.<Model>WhereInput`)
- A mutation result that's not a discriminated union
- An API response not following `ApiResponse<T>`
- A guard returning `unknown` instead of narrowing to a specific type

## Suggested category slugs

- `service-return-type-loose`
- `downstream-revalidation`
- `unknown-in-types`
- `as-cast`
- `generic-widened`
- `loose-mutation-result`
- `api-response-shape`
- `prisma-where-loose`
- `guard-returns-unknown`

## Severity

Most data-contract violations are `major` — they erode type safety across the layer. `blocker` if a service-wide return type would force consumers to re-validate across many files.

## Output

JSON array wrapped in ```json fenced block. `agent`: "data-contract". Required fields as in other reviewers.

If no findings: `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/data-contract.md
git commit -m "feat(uber-review): data-contract reviewer prompt"
```

---

## Task 2.5: Create `prompts/security.md`

**Files:**
- Create: `.claude/skills/uber-review/prompts/security.md`

- [ ] **Step 1: Create the file**

```markdown
# Security reviewer prompt

You are the security reviewer. You focus on authentication, authorization, input validation, and cache safety in this codebase.

## Your lens

The project's security baseline:

- **Mutating routes use `requirePlayer()`** or equivalent auth gate before any DB write
- **Boundaries validate with Zod** — `lib/schemas/` schemas at API route entry and form submit. Never trust client state for writes.
- **Cache headers on auth-gated routes use `Cache-Control: private`** — never `public` (shared caches could serve one user's response to another)
- **Never `Cache-Control: immutable` on APIs** — for static assets only
- **Player ownership checks** — operations like "buy ship for player X" must verify `X == session player id`, not just that the session exists
- **No raw SQL with user input** — use Prisma parameterized queries or `$queryRaw` with proper escaping
- **No secrets in client-bundled env vars** — server-only env vars without `NEXT_PUBLIC_` prefix must not be imported by client code

You look for:

- A mutating route missing the auth gate
- A Zod schema bypassed (raw `request.body` access into Prisma)
- `Cache-Control: public` on a route behind `requirePlayer()`
- `Cache-Control: immutable` on an API endpoint
- Player ownership not verified (client-supplied id used as the target without comparison to session)
- Raw SQL string interpolation with user input
- A `process.env.SECRET_KEY` imported by a file that ends up in the client bundle (path heuristic: imported by `app/` UI files, components, hooks)

## Suggested category slugs

- `missing-auth-gate`
- `missing-zod-validation`
- `cache-public-on-auth-route`
- `immutable-on-api`
- `missing-ownership-check`
- `raw-sql-injection-risk`
- `server-secret-in-client`

## Severity

- Missing auth gate → `blocker` if it's a mutating route creating real data
- Missing ownership check → `blocker` if it lets one user act on another's data
- Missing Zod → `major`
- Cache header issues → `major`
- Raw SQL → `blocker` if user-controlled

## Output

JSON array wrapped in ```json fenced block. `agent`: "security". Required fields as in other reviewers.

If no findings: `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/security.md
git commit -m "feat(uber-review): security reviewer prompt"
```

---

## Task 2.6: Create `prompts/user-journey.md`

**Files:**
- Create: `.claude/skills/uber-review/prompts/user-journey.md`

- [ ] **Step 1: Create the file**

```markdown
# User journey reviewer prompt

You are the user-journey / UI-UX reviewer. You focus on the end-to-end experience for the user in this Next.js 16 app.

## Your lens

The project's UI baseline:

- **Data fetching** uses `useSuspenseQuery` + `QueryBoundary` wrapper. Components don't inline `isLoading` / `isError` checks.
- **Hydration safety** — `"use client"` components still render on the server for initial HTML. `useSuspenseQuery` fires during render, not in an effect — `QueryBoundary` uses a mounted guard to defer children until after hydration. Don't introduce data fetching that would fire on the server.
- **Native `<dialog>` modals** use the `Dialog` component (`components/ui/dialog.tsx`). `showModal()` centers via UA styles — never `m-0` / `inset-auto` on modal dialogs.
- **Form controls** are from `components/form/` (`TextInput`, `NumberInput`, etc.). Never raw `<input>` or `<select>`.
- **Existing components** — use `Button`, `Card`, `Badge`, `EmptyState`, `ErrorFallback`, `LoadingFallback`, `DataTable`, `StatList`, `StatDisplay`. Don't reinvent.
- **Accessibility** — actionable elements use semantic HTML (`<button>` for actions, `<a>` for navigation). Keyboard focus traps in modals (handled by `<dialog>` modal mode). ARIA labels on icon-only buttons.
- **Loading & error boundaries** — every data-fetching section wraps in `QueryBoundary` (Suspense + ErrorBoundary + QueryErrorResetBoundary).

You look for:

- Raw `<input>` / `<select>` / `<button onClick>` where there's a project component
- Data fetching without `QueryBoundary`
- Custom loading/error states instead of the boundary primitives
- `m-0` or `inset-auto` on a modal `<dialog>`
- Icon-only buttons missing `aria-label`
- Anchor used as a button or vice versa
- Inline `isLoading` checks instead of Suspense
- Server/client component mix where a server component imports a client-only hook

## Suggested category slugs

- `raw-form-element`
- `missing-query-boundary`
- `custom-loading-state`
- `modal-broken-centering`
- `missing-aria-label`
- `semantic-html-misuse`
- `inline-suspense-checks`
- `server-imports-client-hook`

## Severity

Most UX issues are `major` (clear convention break) or `minor` (cleanup). Accessibility issues on actionable elements are `major`.

## Output

JSON array wrapped in ```json fenced block. `agent`: "user-journey". Required fields as in other reviewers.

If no findings: `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/user-journey.md
git commit -m "feat(uber-review): user-journey reviewer prompt"
```

---

## Task 2.7: Create `prompts/tests.md`

**Files:**
- Create: `.claude/skills/uber-review/prompts/tests.md`

- [ ] **Step 1: Create the file**

```markdown
# Tests reviewer prompt

You are the tests reviewer. You check whether changes to `lib/engine/`, `lib/services/`, or `lib/tick/processors/` have appropriate Vitest coverage, and whether existing/new tests are meaningful.

## Your lens

The project's testing baseline:

- **Engine functions are pure** — they MUST have Vitest tests covering edge cases. No DB dependency, so tests should be exhaustive.
- **Services have business logic** — tests cover happy path and major error paths. Use a real test database (project preference) — don't mock Prisma.
- **Tick processors** — tests cover the processor body with the in-memory adapter (`lib/tick/adapters/memory/`).
- **Meaningful assertions** — `expect(result).toBeTruthy()` for a complex object is weak. Assert specific values or properties.

You look for:

- A new exported function in `lib/engine/` with no matching test file
- A new service method in `lib/services/<x>.ts` with no test
- A new tick processor with no test
- An existing test file that didn't get updated when its source changed (asymmetric diff: source changed, test didn't)
- A test that's just `expect(fn()).toBeDefined()` — meaningless
- A test mocking Prisma (project convention is real DB)
- A test that doesn't actually exercise the changed path

## Suggested category slugs

- `engine-missing-test`
- `service-missing-test`
- `processor-missing-test`
- `test-not-updated`
- `weak-assertion`
- `prisma-mocked-in-test`
- `test-misses-changed-path`

## Severity

- Missing test for new engine code → `major` (engine is pure, should always be tested)
- Missing service test → `major` for non-trivial methods, `minor` for thin wrappers
- Weak assertion → `minor`
- Mocked Prisma → `major` (convention violation)

## Output

JSON array wrapped in ```json fenced block. `agent`: "tests". Required fields as in other reviewers.

If no findings: `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/tests.md
git commit -m "feat(uber-review): tests reviewer prompt"
```

---

## Task 2.8: Create `prompts/performance.md`

**Files:**
- Create: `.claude/skills/uber-review/prompts/performance.md`

- [ ] **Step 1: Create the file**

```markdown
# Performance reviewer prompt

You are the performance reviewer. You look for runtime performance issues — N+1, expensive renders, missing memoization, render-loop misuse.

## Your lens

You look for:

- **N+1 queries** — loop containing a Prisma call. Should batch. (DB-integrity also flags this inside `$transaction`; you flag the broader case including reads.)
- **Missing memoization on expensive computations** — `useMemo` for results derived from large arrays that re-compute every render
- **Inline-defined objects/arrays in JSX** causing unnecessary child re-renders (`<Comp data={{...}} />`)
- **Viewport-keyed React Query keys** causing flicker and redundant calls on every pan/zoom — tick-scoped data should be fetched once per tick, filtered client-side
- **Pixi callbacks using debounce instead of throttle** — Pixi ticker fires 60fps; `setState` debounced never fires during continuous activity. Use leading+trailing throttle.
- **Frustum-gate object creation, not just visibility** — Pixi `SystemObject` constructors are expensive. Create only for systems in the frustum, batched per frame.
- **Bulk DB writes inside `$transaction` not batched** — `createManyAndReturn` / `createMany` / `unnest()` UPDATE pattern.

## Suggested category slugs

- `n-plus-one-query`
- `missing-memoization`
- `inline-jsx-props`
- `viewport-keyed-query`
- `debounce-in-render-loop`
- `unbatched-object-creation`
- `unbatched-tx-writes`

## Severity

- N+1 in production code paths → `major`; in cold paths → `minor`
- Render perf issues → `major` if user-noticeable (e.g., panning the map), `minor` if hypothetical
- `unbatched-tx-writes` at scale → can be `blocker` if it would blow the 30s PostgreSQL timeout

## Output

JSON array wrapped in ```json fenced block. `agent`: "performance". Required fields as in other reviewers.

If no findings: `[]`.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/uber-review/prompts/performance.md
git commit -m "feat(uber-review): performance reviewer prompt"
```

---

## Task 2.9: Update `SKILL.md` — file classification, parallel dispatch, dedup, skip-gates

This is the big update. Add the missing pipeline steps to the orchestration playbook. Replace specific sections of `SKILL.md` rather than rewriting wholesale.

**Files:**
- Modify: `.claude/skills/uber-review/SKILL.md`

- [ ] **Step 1: Replace the "Pipeline (PR 1 scope: architect only)" section header**

Find the line in `SKILL.md`:

```markdown
## Pipeline (PR 1 scope: architect only)
```

Replace with:

```markdown
## Pipeline
```

- [ ] **Step 2: Insert file classification after step 1 (fetch diff)**

Find the end of step 1 (the line that ends `Use `headRepository.nameWithOwner` for permalink format (PR mode output, added in PR 3).`).

Immediately after, insert a new step 1.5:

````markdown
### 1.5. Classify each changed file

For each file in the diff, assign one classification:

- **docs** — matches `*.md`, `LICENSE`, `*.txt`
- **schema** — matches `prisma/schema.prisma` or `prisma/migrations/**`
- **config** — matches `package.json`, `package-lock.json`, `tsconfig*.json`, `next.config.*`, `eslint.config.*`, `vitest.config.*`, `.env.*`, `*.config.{ts,js,mjs}`
- **asset** — images (`*.png`, `*.jpg`, `*.svg`, `*.webp`), fonts (`*.woff2`, `*.ttf`), files under `public/`
- **source** — anything else (default catch-all)

Hold the classification as a map `file → classification` for use by the skip-gate matrix.

A chunk is **docs-only** if every file is `docs`; **schema-only** if every file is `schema` (or `schema` + `docs`); **config-only** if every file is `config` (or `config` + `docs`). The full PR (one chunk in PR 2) is classified accordingly.
````

- [ ] **Step 3: Insert the skip-gate matrix between architect (step 4) and validation (step 5)**

Find the section header `### 5. Validate findings (tiered)`.

Immediately before it, insert a new step 4.5:

````markdown
### 4.5. Dispatch the reviewer team (parallel, skip-gated)

Skip this section if:
- Architect returned `blocker` (pipeline already halted; only architect's findings get validated)
- `--only=architect` was passed
- `--skip-architect` was passed AND `--only` excludes downstream reviewers (rare; default behavior is "skip architect but run everyone else")

For the single chunk (PR 2 — the whole PR is one chunk; PR 3 adds chunker), determine which reviewers run based on file classification:

| Reviewer | Runs when chunk contains... |
|----------|------------------------------|
| Conventions | At least one `source` file (skips docs-only / schema-only / config-only) |
| DB integrity | At least one file under `prisma/`, `lib/services/`, `lib/tick/processors/`, `lib/tick/adapters/prisma/`, `lib/tick/world/` |
| Data contract | Files spanning ≥2 layers from {prisma, lib/services, lib/tick, app/api, lib/hooks, components, app/(game), app/(auth)} |
| Security | At least one file under `app/api/`, `lib/services/`, `lib/schemas/`, `app/(auth)/`, `prisma/`, OR any file containing `requirePlayer`, `getServerSession`, or `session.` (grep the diff body) |
| Silent failures | At least one `source` file |
| User journey | At least one file under `app/(game)/`, `app/(auth)/`, `components/` |
| Tests | At least one source file under `lib/engine/`, `lib/services/`, `lib/tick/processors/` |
| Performance | At least one `source` file |

Apply `--only` filter on top of the matrix (if `--only=security,db-integrity`, only those two run).

Apply effort dial for model selection per reviewer (see "Effort dial" section above).

**Dispatch in parallel** — send all matching reviewer `Agent` tool calls in a single message. Each Agent call:

- `description`: `<reviewer name> review`
- `subagent_type`: `general-purpose`
- `model`: per effort dial
- `prompt`: contents of `prompts/<reviewer>.md` + relevant rule injection (see below) + the chunk's diff

**Rule injection**: for Conventions, inject the full contents of `rules/code-standards.md`. For all reviewers, inject `rules/severity-rubric.md`. Concatenate at the end of the agent's prompt under a clear separator.

Collect each reviewer's JSON output. Parse each (same fenced-block regex + retry-once policy as architect). Findings from all reviewers go into the pool alongside architect's.

Log skipped reviewers with reason (e.g., "user-journey: skipped — no UI files in chunk").
````

- [ ] **Step 4: Insert dedup between dispatch (4.5) and validation (5)**

Immediately after the dispatch section above, before `### 5. Validate findings (tiered)`, insert:

````markdown
### 4.6. Dedup findings

**Pass 1 — deterministic.**

Collect all findings into a pool. Group by `(file, normalized_line, category)` where `normalized_line` is the start line (parse "42" or "42-48" → 42).

For each group with >1 finding:
- Merge: pick the **highest** severity
- Concatenate messages (joined by ` | `)
- Concatenate evidence (joined by `\n\n`)
- Record `agents` as the array of co-flaggers (e.g., `["security", "data-contract"]`)
- Pick first `suggested_fix` that's non-empty

**Pass 2 — semantic merge (Haiku, on-demand).**

After Pass 1, scan for findings at the same `(file, overlapping line range)` but with **different** categories.

Define "overlapping line range": if finding A is `42-45` and finding B is `44-50`, they overlap. If finding A is `42` and finding B is `60`, they don't.

For each such pair (at most 5-15 per typical PR):

Dispatch one Haiku Agent call:

- `description`: "Dedup semantic merge"
- `subagent_type`: `general-purpose`
- `model`: `haiku`
- `prompt`:

```
You are deciding whether two code review findings describe the same underlying issue.

Finding A:
  file: <fileA>
  line: <lineA>
  category: <categoryA>
  message: <messageA>
  evidence: <evidenceA>

Finding B:
  file: <fileB>
  line: <lineB>
  category: <categoryB>
  message: <messageB>
  evidence: <evidenceB>

Are these the same underlying issue (different lens, same problem)?

Return ONLY a JSON object in a ```json fenced block:

{
  "merge": true | false,
  "rationale": "one-sentence reason"
}

When uncertain, prefer "merge: false". Keeping both findings separately is safer than wrongly collapsing distinct issues.
```

Parse output. If `merge: true`, combine the pair into one finding (highest severity, both messages joined, both agents recorded). If parse fails or `merge: false`, leave both as separate findings.
````

- [ ] **Step 5: Update the "What's NOT in PR 1" section header**

Find the section header `## What's NOT in PR 1` and replace with `## What's NOT yet implemented`. Update the list to reflect PR 2's additions:

```markdown
## What's NOT yet implemented

These are added in PR 3:
- Chunking for large PRs (>20 files) — currently the full PR is one chunk
- PR mode comment posting via `gh pr comment` with permalinks
```

Remove the bullet points about reviewer agents, classification, skip-gates, and dedup (now done).

- [ ] **Step 6: Update the "Reviewer dispatch log" placeholder in the markdown report template**

Find in the markdown template:

```markdown
## Reviewer dispatch log

(PR 2 will populate this with per-chunk dispatch decisions.)
```

Replace with:

```markdown
## Reviewer dispatch log

For the single chunk (full PR):

- Files in chunk: <count>
- Classification: <docs-only | schema-only | config-only | mixed (default)>

Reviewer status:

| Reviewer | Status | Reason |
|----------|--------|--------|
| Conventions | ran / skipped | <reason if skipped> |
| DB integrity | ran / skipped | ... |
| Data contract | ran / skipped | ... |
| Security | ran / skipped | ... |
| Silent failures | ran / skipped | ... |
| User journey | ran / skipped | ... |
| Tests | ran / skipped | ... |
| Performance | ran / skipped | ... |

Findings collected: <total before dedup>
Findings after dedup (Pass 1): <count>
Findings after dedup (Pass 2): <count>
Findings after validation filter: <count>
```

- [ ] **Step 7: Verify the file still parses**

Read `SKILL.md` end-to-end. Confirm:
- Frontmatter intact at top
- All sections present in logical order: Inputs → Effort dial → Pipeline (1, 1.5, 2, 3, 4, 4.5, 4.6, 5, 6, 7) → Error handling → What's NOT yet implemented
- Markdown table syntax correct (no orphan pipes)

- [ ] **Step 8: Commit**

```bash
git add .claude/skills/uber-review/SKILL.md
git commit -m "feat(uber-review): file classification, parallel reviewers, dedup (PR 2 orchestration)"
```

---

## Task 2.10: End-to-end verification with full reviewer team

- [ ] **Step 1: Create a test branch with broad-spectrum changes**

```bash
git checkout -b test/uber-review-pr2
```

Make small changes that should trigger several reviewers:

1. **Conventions trigger** — add a deliberate `as` cast somewhere:
   ```typescript
   // in lib/utils/something.ts
   const x = someValue as string;
   ```

2. **Silent failures trigger** — add a missing-await:
   ```typescript
   // in any async function
   const handler = () => { somePromise(); }; // unawaited
   ```

3. **Security trigger** — add a route handler without Zod (if you have a test route):
   Or skip if it's risky to wire up.

Commit each separately so the diff is readable.

- [ ] **Step 2: Invoke the skill**

Run: `/uber-review`

Expected:
- Architect runs first, returns `clean` or `minor` (likely no architectural issues from small targeted changes)
- All 8 downstream reviewers run in parallel (no skip-gates trigger for source-file changes)
- Each emits at least its triggered finding
- Dedup Pass 1 collapses any same-`(file, line, category)` overlaps
- Dedup Pass 2 (Haiku) may fire on any same-line/different-category overlaps
- Validator runs per finding
- Report shows findings grouped by severity

- [ ] **Step 3: Inspect the markdown report**

Confirm:
- Reviewer dispatch log shows all 8 reviewers as `ran`
- Findings include at least the triggers above
- Dedup section shows pre/post counts
- Validator confidences are sensible (the test triggers should score >70)

- [ ] **Step 4: Test a skip-gate scenario**

Create a docs-only branch:

```bash
git checkout main
git checkout -b test/uber-review-docs-only
echo "edit" >> docs/SPEC.md
git commit -am "test: docs-only change"
```

Run `/uber-review`. Expected:
- Architect runs
- All downstream reviewers SKIP (logged as skipped — docs-only chunk)
- Report shows architect only

- [ ] **Step 5: Cleanup**

```bash
git checkout main
git branch -D test/uber-review-pr2 test/uber-review-docs-only
```

Fix any prompt issues discovered during verification by editing the relevant `prompts/*.md` and committing.

---

# PR 3 — Chunker, PR mode, spec cleanup

End state: handles large PRs via the chunker, integrates with GitHub via `gh pr diff` and `gh pr comment`, ships a cleaned-up spec.

## Task 3.1: Update `SKILL.md` — chunker for >20-file PRs

**Files:**
- Modify: `.claude/skills/uber-review/SKILL.md`

- [ ] **Step 1: Insert chunker section between file classification (1.5) and architect dispatch (2)**

Find the section header `### 2. Dispatch the architect`.

Immediately before it, insert a new step 1.6:

````markdown
### 1.6. Chunk the diff (if large)

Default chunk-size target is 20 files. Override with `--chunk-size=N`.

**If the diff has ≤ chunk-size files**: one chunk = the full diff. Skip the rest of this step.

**If the diff has > chunk-size files**: cluster by feature stem.

#### Feature stem extraction

For each file, strip recognized layer prefixes to extract a feature stem:

| Path pattern | Feature stem |
|--------------|--------------|
| `lib/services/<feature>/...` | `<feature>` |
| `lib/services/<feature>.ts` | `<feature>` |
| `lib/hooks/use-<feature>.ts` | `<feature>` |
| `lib/hooks/<feature>.ts` | `<feature>` |
| `lib/engine/<feature>.ts` | `<feature>` |
| `lib/engine/<feature>/...` | `<feature>` |
| `lib/tick/processors/<feature>.ts` | `<feature>` |
| `lib/tick/world/<feature>.ts` | `<feature>` |
| `lib/tick/adapters/prisma/<feature>.ts` | `<feature>` |
| `lib/tick/adapters/memory/<feature>.ts` | `<feature>` |
| `app/api/game/<feature>/...` | `<feature>` |
| `app/(game)/<feature>/...` | `<feature>` |
| `app/(auth)/<feature>/...` | `<feature>` |
| `components/<feature>/...` | `<feature>` |
| anything else | `shared` |

The `<feature>` is the first directory segment after the prefix, or the filename stem if it's a leaf file.

#### Cluster and cap

Group files by feature stem. For each group:

- If size ≤ chunk-size: emit as one chunk
- If size > chunk-size and ≤ 35: emit as one chunk, log a `large chunk` notice
- If size > 35: split by layer within the feature. Order: engine → services → tick (processors / world / adapters) → api → hooks → components → app pages. Each split ≤ 35.

The `shared` group is capped at chunk-size; if larger, split alphabetically.

Each chunk has its own file classification (recompute from the chunk's files).

#### Architect still sees full diff

The architect is dispatched once on the **full** unified diff, not per chunk. Chunking only affects the downstream reviewer dispatch in step 4.5.

#### Reviewers dispatch per chunk

Step 4.5's parallel dispatch fires **per chunk**. For each chunk, compute its file classification, apply skip-gates, and dispatch matching reviewers in parallel.

Findings from all chunks pool together for dedup (step 4.6) and validation (step 5).
````

- [ ] **Step 2: Update step 4.5 reference to mention "per chunk"**

In step 4.5, find the line:

```markdown
For the single chunk (PR 2 — the whole PR is one chunk; PR 3 adds chunker), determine which reviewers run based on file classification:
```

Replace with:

```markdown
**For each chunk** (computed in step 1.6), determine which reviewers run based on the chunk's file classification:
```

- [ ] **Step 3: Update the "What's NOT yet implemented" section**

Remove the bullet about chunking. Should now only have PR mode bullet, which the next task removes too.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/uber-review/SKILL.md
git commit -m "feat(uber-review): semantic chunker for large PRs"
```

---

## Task 3.2: Update `SKILL.md` — PR mode comment posting

**Files:**
- Modify: `.claude/skills/uber-review/SKILL.md`

- [ ] **Step 1: Replace the PR mode placeholder in step 8**

Find:

```markdown
### 8. (PR 3) PR mode comment

Not yet implemented. PR 3 adds `gh pr comment` posting.
```

Replace with:

````markdown
### 8. PR mode — post a single summary comment

If PR mode (i.e., positional `<PR#>` was provided):

#### Compose the comment

Use this template:

```markdown
### /uber-review (effort: <effort>, threshold: <N>)

<if architect halted: "⚠ **Pipeline halted by architect (blocker severity).**" + architect's blocker findings>

**Architect**: <severity>

Found <N> issues (<M> filtered):

<for each finding, sorted by severity then file:>
<n>. <file>:<line> · **<severity>** · <category> — <message> _[<agent(s)>, conf: <N>]_

   <permalink to file:lines with full sha>

<if M > 0:>
<details>
<summary>Filtered findings (<M> below threshold)</summary>

<for each filtered finding:>
- <file>:<line> · <severity> · <category> · conf <N> — <message>

</details>

<small>🤖 Generated by /uber-review</small>
```

Permalink format (use `headRepository.nameWithOwner` from `gh pr view` and `headRefOid` for the sha):

```
https://github.com/<owner>/<repo>/blob/<headRefOid>/<file>#L<startLine>-L<endLine>
```

For a single-line finding (no range), use `#L<line>` without the range suffix.

#### Post the comment

Write the comment body to a temp file (avoids shell-escaping issues with backticks and special chars):

```
TMP=$(mktemp)
# (orchestrator writes comment body to $TMP)
gh pr comment <#> --body-file $TMP
rm $TMP
```

If the `gh` command fails (e.g., network, auth), log a warning and proceed — the markdown report on disk is the primary artifact; the PR comment is additive.

If the user has already commented `/uber-review` on the same PR head sha (i.e., the same head commit has a previous comment from this skill), append a "Re-run" note to the new comment rather than refusing. Detection: `gh pr view <#> --json comments --jq '.comments[].body'` and search for `/uber-review` markers.
````

- [ ] **Step 2: Remove the "What's NOT yet implemented" section entirely**

Everything is now implemented. Find:

```markdown
## What's NOT yet implemented

These are added in PR 3:
- ...
```

Delete the section and the heading.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/uber-review/SKILL.md
git commit -m "feat(uber-review): PR mode with single summary comment and permalinks"
```

---

## Task 3.3: Clean up `SPEC.md`

Per the user request: remove non-goals, remove `/ultrareview` mentions, keep only what's relevant for someone reading the spec to understand and maintain the skill.

**Files:**
- Modify: `.claude/skills/uber-review/SPEC.md`

- [ ] **Step 1: Remove the "Non-goals" section entirely**

Find the section starting with `## Non-goals` (around line 15) and ending before `## Invocation`. Delete those lines including the heading and blank line.

- [ ] **Step 2: Replace the "Purpose" section to remove ultrareview reference**

Find the line:

```markdown
This is a cheaper alternative to `/ultrareview` for routine in-development reviews — the user remains cost-conscious and wants a tool that can be run frequently without burning a hole in the API budget.
```

Delete this paragraph entirely.

The remaining Purpose section should read:

```markdown
## Purpose

A project-local code review skill that uses a team of specialized agents to review a PR or local branch in parallel. Each agent reviews through a single narrow lens (security, database integrity, data contract, conventions, etc.). An architect agent runs first and can halt the pipeline if it detects an architectural problem severe enough to require approach-level rework.

The goal: catch more issues than a single general-purpose reviewer, with cost controlled by per-agent model selection, file-pattern skip-gates, and tiered LLM validation of findings.
```

- [ ] **Step 3: Remove the "Implementation notes (deferred to plan)" section**

The deferred questions are now resolved in this plan. Find the section starting with `## Implementation notes (deferred to plan)` and delete it entirely.

- [ ] **Step 4: Remove `halt-rubric.md` from the skill file layout**

The implementation inlines the architect's halt rubric inside `prompts/architect.md` rather than a separate file. Find in `SPEC.md`:

```
└── rules/
    ├── code-standards.md       # forbidden-patterns checklist for conventions agent
    ├── severity-rubric.md      # shared severity scale (other agents reference this)
    └── halt-rubric.md          # architect's blocker-test wording (the fix-simulation test)
```

Replace with:

```
└── rules/
    ├── code-standards.md       # forbidden-patterns checklist for conventions agent
    └── severity-rubric.md      # shared severity scale (other agents reference this)
```

- [ ] **Step 5: Update status line**

Find:

```markdown
**Status**: Design (not yet implemented)
```

Replace with:

```markdown
**Status**: Implemented (see `docs/design/implementation/uber-review-skill.md` for the build plan)
```

- [ ] **Step 6: Verify the spec still parses well**

Read the file. Confirm:
- Header block intact
- Purpose section reads cleanly
- All technical sections (Invocation, Pipeline, Agents, Rubric, Chunking, Finding schema, Skip-gate matrix, Output, Skill file layout, Error handling) preserved verbatim

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/uber-review/SPEC.md
git commit -m "docs(uber-review): clean up spec — remove non-goals, ultrareview mentions, deferred questions"
```

---

## Task 3.4: End-to-end verification on a real PR

The skill needs at least one PR-mode dry run before declaring done.

- [ ] **Step 1: Pick a real PR to test against**

Either:
- A merged PR from this repo's history (use the PR number from `gh pr list --state merged --limit 10`), OR
- A draft PR you create from a small feature branch

For a merged PR, `gh pr diff <#>` still works; the eligibility check will reject it for being closed — temporarily relax that check in `SKILL.md` for the test, or use a draft PR. (Recommend: small draft PR.)

- [ ] **Step 2: Create a small test PR**

```bash
git checkout -b test/uber-review-real-pr
# make a small change
echo "// test" >> lib/utils/numbers.ts
git commit -am "test: small change for uber-review PR mode"
git push -u origin test/uber-review-real-pr
gh pr create --draft --title "test: uber-review verification" --body "Testing /uber-review PR mode end-to-end"
# note the PR number from the URL
```

- [ ] **Step 3: Invoke the skill in PR mode**

Run: `/uber-review <PR#>`

Expected:
- Skill fetches via `gh pr view` (eligibility check passes for draft? — check spec; if draft is rejected, undraft the PR with `gh pr ready <#>`)
- Diff fetched via `gh pr diff`
- Architect runs (clean expected for trivial change)
- Downstream reviewers run
- Findings deduped and validated
- Markdown report written to `.claude/reviews/`
- Comment posted to the PR via `gh pr comment`

- [ ] **Step 4: Inspect the PR comment**

Open the PR in browser (`gh pr view <#> --web`). Confirm:
- Comment is posted with the correct format
- Permalinks (if any findings) point to the correct file:line on the head sha
- Markdown renders properly on GitHub
- `<details>` block for filtered findings collapses correctly

- [ ] **Step 5: Test a chunking scenario** *(optional)*

If you can stage a PR with >20 files (e.g., a refactor branch), invoke `/uber-review` and confirm:
- Multiple chunks computed
- Each chunk's reviewers logged in the dispatch log
- Findings still merged into one report

- [ ] **Step 6: Cleanup**

```bash
gh pr close <#> --delete-branch
git checkout main
```

- [ ] **Step 7: Fix any issues found**

If the comment format renders badly, fix in `SKILL.md` step 8 template and re-test. Commit fixes.

---

## Self-review (run after all PRs complete)

After PR 3 lands, run through this checklist:

**Spec coverage** — for each section of `SPEC.md`, point to the task that implemented it:

- [ ] Invocation (flags + modes) → SKILL.md "Inputs" section (Task 1.6)
- [ ] Effort dial → SKILL.md "Effort dial" (Task 1.6)
- [ ] Pipeline (fetch → architect → chunker → reviewers → dedup → validate → filter → render) → SKILL.md sections 1–8 (Tasks 1.6, 2.9, 3.1, 3.2)
- [ ] Architect halt rule → architect.md + SKILL.md step 4 (Tasks 1.4, 1.6)
- [ ] Agent roster (9 agents) → prompts/ (Tasks 1.4, 2.1–2.8)
- [ ] Severity rubric → rules/severity-rubric.md (Task 1.2)
- [ ] Architect blocker rubric → architect.md inline (Task 1.4)
- [ ] Chunking algorithm → SKILL.md step 1.6 (Task 3.1)
- [ ] Finding schema → architect.md + each reviewer prompt + SKILL.md parser
- [ ] Skip-gate matrix → SKILL.md step 4.5 table (Task 2.9)
- [ ] File classification → SKILL.md step 1.5 (Task 2.9)
- [ ] Dedup (Pass 1 + Pass 2) → SKILL.md step 4.6 (Task 2.9)
- [ ] Validation (tiered) → SKILL.md step 5 + validator.md (Task 1.6, 1.5)
- [ ] Filter threshold → SKILL.md step 6 (Task 1.6)
- [ ] Terminal output → SKILL.md step 7 (Task 1.6)
- [ ] Markdown report → SKILL.md step 7 template (Task 1.6, updated 2.9)
- [ ] PR comment → SKILL.md step 8 (Task 3.2)
- [ ] Error handling → SKILL.md "Error handling" (Task 1.6)
- [ ] `.gitignore` for `.claude/reviews/` → Task 1.1
- [ ] Skill file layout → matches actual directory tree

**Verification end-state**:
- [ ] Local mode works on a clean branch (Task 1.7)
- [ ] Local mode triggers reviewers correctly on a multi-trigger branch (Task 2.10)
- [ ] Skip-gates work on a docs-only branch (Task 2.10)
- [ ] PR mode posts a clean comment on a real PR (Task 3.4)

If any gap, add a task before declaring done.
