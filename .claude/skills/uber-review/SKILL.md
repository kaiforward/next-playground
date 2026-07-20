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
- `--only=<comma-separated>` — restrict to listed reviewers. Names: `architect`, `conventions`, `world-integrity`, `data-contract`, `boundary-safety`, `silent-failures`, `user-journey`, `tests`, `performance`.
- `--skip-architect` — skip the gating pass.
- `--threshold=<N>` — confidence floor for inclusion (default 70).
- `--chunk-size=<N>` — target chunk size (default 20).

## Effort dial

| Effort | Architect | Reasoning reviewers | Mechanical reviewers |
|--------|-----------|---------------------|----------------------|
| `quick` | sonnet | haiku | haiku |
| `standard` (default) | opus | sonnet | haiku |
| `deep` | opus | sonnet (+ opus for data-contract & boundary-safety) | haiku |

Reasoning reviewers: world-integrity, data-contract, boundary-safety, user-journey, tests, performance.
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

#### 1.1. Check out the PR branch (PR mode only) — REQUIRED

Reviewer and validator agents `Read` source files for context (world-integrity, boundary-safety, and silent-failures need whole-file context to confirm whether a value reaches `World` state, whether input is validated before use, and call sites — the diff hunk alone is not enough). Those reads resolve against the **working tree**, which in PR mode usually sits on the PR's **base** branch. Without this step, agents review **pre-PR code** and emit false positives — most dangerously, spurious "won't compile" findings from cross-chunk renames they can't see, and a worthless "boundary-safety clean" against the wrong code.

So before dispatching any agent, check out the PR head so the tree matches the diff:
- Bash: `git fetch origin <headRefName>` then `git checkout <headRefName>`.

No need to restore the original branch afterward — fixes land on this branch anyway. (If the tree is dirty and checkout would fail, skip it and instead tell every agent to rely only on the provided chunk diff and not Read source.)

### 1.2. Determine the review stage

Every review is either a **phase** review or the **final** pre-merge review, and you can always tell which from signals you already have:

- Diff base is a **shared feature branch** → **phase** review. No doc fold expected.
- Diff base is **main** and this is the pre-merge whole-branch review (known from session context — the user asks for it deliberately before merging) → **final** review. The feature's doc lifecycle (spec promoted to `docs/active/`, umbrella + `docs/SPEC.md` updated, build plan deleted) must already be on the branch at this point.
- Genuinely ambiguous (e.g. a single-PR feature reviewed mid-work against main) → ask the user which it is; one question beats a wrong assumption.

State the determination in the report header (`Stage: final` / `Stage: phase`). On a **final** review, append to the architect's prompt (step 2): "This is the final pre-merge review — the feature's doc fold must be present in this diff. If the diff contains no doc fold (no spec promoted into docs/active/, build plan not deleted), emit a `major` finding with category `missing-doc-fold`." Phase reviews keep Lens 2's default behaviour (no doc in diff → silently skip).

### 1.5. Classify each changed file

For each file in the diff, assign one classification:

- **docs** — matches `*.md`, `LICENSE`, `*.txt`
- **config** — matches `package.json`, `package-lock.json`, `tsconfig*.json`, `next.config.*`, `eslint.config.*`, `vitest.config.*`, `prettier.config.*`, `.env.*`, `*.config.{ts,js,mjs}`, `Dockerfile*`, `Makefile`, `*.{yaml,yml}`, `.github/**`, and the common dotfile configs: `.gitignore`, `.gitattributes`, `.dockerignore`, `.editorconfig`, `.npmrc`, `.nvmrc`, `.prettierrc*`, `.eslintrc*`
- **asset** — images (`*.png`, `*.jpg`, `*.jpeg`, `*.gif`, `*.ico`, `*.svg`, `*.webp`, `*.avif`), fonts (`*.woff`, `*.woff2`, `*.ttf`, `*.otf`), files under `public/`
- **source** — anything else (default catch-all)

Hold the classification as a map `file → classification` for use by the skip-gate matrix.

A chunk is **docs-only** if every file is `docs`; **config-only** if every file is `config` (or `config` + `docs`). The full PR is classified accordingly.

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
| `lib/tick/adapters/memory/<feature>.ts` | `<feature>` |
| `app/api/game/<feature>/...` | `<feature>` |
| `app/(game)/<feature>/...` | `<feature>` |
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

> **Note — the architect also runs a spec-conformance pass (Lens 2 in `prompts/architect.md`).** Its spec is the change's design/spec doc, which rides in the diff itself: an added `docs/build-plans/` file (deleted only at merge, so still present at review time) or a doc promoted into `docs/active/` / `docs/planned/` in the same diff. The full diff already carries it — do not strip docs from the architect's diff. When the diff contains no such doc, the architect silently skips that lens.

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

**For each chunk** (computed in step 1.6), determine which reviewers run based on the chunk's file classification:

| Reviewer | Runs when chunk contains... |
|----------|------------------------------|
| Conventions | At least one `source` file (skips docs-only / config-only) |
| World integrity | At least one file under `lib/world/`, `lib/tick/processors/`, `lib/tick/world/`, `lib/tick/adapters/`, `lib/engine/`, or `lib/services/` |
| Data contract | Files spanning ≥2 layers from {lib/world, lib/services, lib/tick, app/api, lib/hooks, components, app/(game)} |
| Boundary safety | At least one file under `app/api/`, `lib/services/`, `lib/schemas/`, or `lib/world/` (save/load path), OR any `.ts`/`.tsx` source file that reads `process.env`, sets a `Cache-Control` header, or builds a save-file path (grep the diff body, restricted to source files — never trigger on markdown/docs that merely *describe* these) |
| Silent failures | At least one `source` file |
| User journey | At least one file under `app/(game)/`, `components/` |
| Tests | **Any** of: (a) a source file under `lib/engine/`, `lib/services/`, `lib/tick/processors/`, `lib/tick/world/`, `lib/tick/adapters/`; **or** (b) a changed test file (path under `**/__tests__/**` or matching `*.test.{ts,tsx}`); **or** (c) a changed pure-logic `.ts` module (not `.tsx`) anywhere that has a co-located test — i.e. a `__tests__/` sibling dir or a `<name>.test.ts` next to it. Rationale: testable logic isn't confined to the `lib/` dirs (e.g. `components/map/pixi/lod.ts` is pure LOD math with `__tests__/lod.test.ts`), and a changed test file should always be reviewed for meaningfulness even when its source sits outside `lib/`. |
| Performance | At least one `source` file |

Apply `--only` filter on top of the matrix (if `--only=boundary-safety,world-integrity`, only those two run).

Apply effort dial for model selection per reviewer (see "Effort dial" section above).

**Dispatch in parallel** — send all matching reviewer `Agent` tool calls in a single message. Each Agent call:

- `description`: `<reviewer name> review`
- `subagent_type`: `general-purpose`
- `model`: per effort dial
- `prompt`: contents of `prompts/<reviewer>.md` + relevant rule injection (see below) + the chunk's diff

**Rule injection**: `CLAUDE.md` is the single source of the project's rules, and the orchestrator already holds it in context. Build a **project-rules block** once per run: the verbatim `## Conventions` and `## Gotchas / Known Pitfalls` sections of the repo-root `CLAUDE.md` (re-read them at dispatch time so they're never stale). Inject that block **plus `rules/severity-rubric.md`** into *every* reviewer. Additionally, inject `rules/code-standards.md` — the dedup-slug catalog + review-only flagging nuance — into the **Conventions** reviewer. Concatenate at the end of each agent's prompt under clear separators (e.g. `## Project rules (from CLAUDE.md)`, `## Severity rubric`, `## Category slugs`). Reviewers no longer carry their own copy of the rules — they read them from the injected CLAUDE.md sections.

Collect each reviewer's JSON output. Parse each (same fenced-block regex + retry-once policy as architect). Findings from all reviewers go into the pool alongside architect's.

Log skipped reviewers with reason (e.g., "user-journey: skipped — no UI files in chunk").

### 4.6. Dedup findings

**Pass 1 — deterministic.**

Collect all findings into a pool. Group by `(file, normalized_line, category)` where `normalized_line` is the start line (parse "42" or "42-48" → 42).

For each group with >1 finding:
- Merge: pick the **highest** severity
- Concatenate messages (joined by ` | `)
- Concatenate evidence (joined by `\n\n`)
- Record `agents` as the array of co-flaggers (e.g., `["boundary-safety", "data-contract"]`)
- Pick first `suggested_fix` that's non-empty

**Pass 2 — semantic merge** is handled by the validator batches in step 5: the validator sees same-file findings side by side and flags same-issue duplicates in its output. No dedicated dedup agents.

### 5. Validate findings (batched by file)

Validation runs as **file-grouped batches**, not one agent per finding — same-file findings share code context, and the per-agent fixed overhead is paid once per batch instead of once per finding.

- `info` findings pass through with `confidence: 100, reason: "info, not validated"` and join no batch.
- Group the remaining pool by `file`. Pack groups into batches capped at **10 findings**: a file group larger than 10 splits; small groups pack together up to the cap, keeping same-file findings in the same batch.
- Batch model = highest severity present in the batch: `opus` if any `blocker`, `sonnet` if any `major`, `haiku` if all-`minor`.

Validator dispatch (one Agent call per **batch**; send all batches in one parallel message):

- `description`: "Validate findings (batch)"
- `subagent_type`: `general-purpose`
- `model`: per the batch tier above
- `prompt`: contents of `prompts/validator.md` + the batch's findings as a JSON array (each carrying its pool `index`) + ~20 lines of code around each cited line (read via `Read`, deduplicated per file region) + relevant rule context: the matching rules from `CLAUDE.md`'s `## Conventions` / `## Gotchas / Known Pitfalls` (canonical), plus those slugs' rows and any flagging nuance from `rules/code-standards.md`

Parse each batch's JSON output (same fenced-block extraction + retry-once). A finding whose entry is missing or malformed defaults to `{ confidence: 0, reason: "validator output malformed" }` — this filters it out.

**Duplicate merge**: the validator returns a `duplicates` array of index pairs it judged to be the same underlying issue. Merge each flagged pair (highest severity, messages joined ` | `, `agents` concatenated) before the filter step.

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
- **Stage**: phase | final
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
- Classification: <docs-only | config-only | mixed (default)>

Reviewer status:

| Reviewer | Status | Reason |
|----------|--------|--------|
| Conventions | ran / skipped | <reason if skipped> |
| World integrity | ran / skipped | ... |
| Data contract | ran / skipped | ... |
| Boundary safety | ran / skipped | ... |
| Silent failures | ran / skipped | ... |
| User journey | ran / skipped | ... |
| Tests | ran / skipped | ... |
| Performance | ran / skipped | ... |

Findings collected: <total before dedup>
Findings after dedup (Pass 1): <count>
Findings after validator duplicate-merge: <count>
Findings after validation filter: <count>
```

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

## 9. Merging after review (PR mode)

Optional, human-gated, and **only** in PR mode. The review pipeline itself never merges — this section documents the hand-off after the findings are in. No flag triggers it automatically; run it only when the user asks to land the PR.

1. **Apply the accepted fixes.** Edit the PR branch to address the findings the user wants fixed (skip the ones they wave off). Keep changes scoped to the review — don't fold in unrelated work.

2. **Re-verify.** Run the project's checks and confirm they pass before claiming done: `tsc` clean, the relevant Vitest suites green (`npx vitest run`), and — for a change with a build surface — the webpack build gate (`npx next build --webpack`). Quote the actual output — never assert "tests pass" without running them.

3. **Doc lifecycle is NOT done here** — it predates the final review (see step 1.2), so the fold was part of the reviewed diff and Lens 2 checked it. If it is somehow missing at this point, complete it now (promote spec → `docs/active/`, umbrella + `docs/SPEC.md`, delete the build plan) and note in the report that the fold went unreviewed.

4. **Pause for a human sanity-check — REQUIRED.** Stop and ask the user to confirm before merging. Explicitly call out anything the review and its agents **cannot** validate — UI/visual changes, interaction or animation behaviour, anything that needs a running app or a human eye — and request an explicit go-ahead. Do not merge on implied approval.

5. **Only after the user confirms**, finish the merge:
   - Commit the fixes to the PR branch and push.
   - Squash-merge into the base branch with a **clean, atomic, feature-describing** commit message — a concise subject plus a `--body-file` body describing *what the feature does*. No "address review feedback", no merge/PR-plumbing noise, no implementation-detail changelog (per the clean-history convention).
   - Fast-forward the local base branch to the merged commit.
   - Delete the merged phase branch (local **and** remote).

This mirrors the shared-feature-branch workflow: phase branches squash into the shared branch as one clean commit each; the single PR to `main` comes later, when the whole feature is done.

## Error handling

- **No diff**: exit early with a friendly message.
- **PR closed/draft**: exit early.
- **Agent malformed output**: one retry; if still bad, skip with warning.
- **Architect severity malformed**: treat as `clean` + warning.
