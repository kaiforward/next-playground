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

## Pipeline

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

### 1.5. Classify each changed file

For each file in the diff, assign one classification:

- **docs** — matches `*.md`, `LICENSE`, `*.txt`
- **schema** — matches `prisma/schema.prisma` or `prisma/migrations/**`
- **config** — matches `package.json`, `package-lock.json`, `tsconfig*.json`, `next.config.*`, `eslint.config.*`, `vitest.config.*`, `.env.*`, `*.config.{ts,js,mjs}`
- **asset** — images (`*.png`, `*.jpg`, `*.svg`, `*.webp`), fonts (`*.woff2`, `*.ttf`), files under `public/`
- **source** — anything else (default catch-all)

Hold the classification as a map `file → classification` for use by the skip-gate matrix.

A chunk is **docs-only** if every file is `docs`; **schema-only** if every file is `schema` (or `schema` + `docs`); **config-only** if every file is `config` (or `config` + `docs`). The full PR (one chunk in PR 2) is classified accordingly.

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

### 8. (PR 3) PR mode comment

Not yet implemented. PR 3 adds `gh pr comment` posting.

## Error handling

- **No diff**: exit early with a friendly message.
- **PR closed/draft**: exit early.
- **Agent malformed output**: one retry; if still bad, skip with warning.
- **Architect severity malformed**: treat as `clean` + warning.

## What's NOT yet implemented

These are added in PR 3:
- Chunking for large PRs (>20 files) — currently the full PR is one chunk
- PR mode comment posting via `gh pr comment` with permalinks
