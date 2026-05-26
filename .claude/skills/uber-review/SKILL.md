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
