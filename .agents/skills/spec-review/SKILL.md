---
name: spec-review
description: Adversarial multi-agent review of a feature spec against the existing codebase. Use when the user runs /spec-review with a document path, or when an approved spec with cross-mechanic surface (economy, tick processors, changed signals or primitives) is about to go to implementation planning.
---

# /spec-review — Adversarial spec review

You are orchestrating an adversarial review of a **feature spec** against the **existing codebase** — before any code is written. This is the counterpart to `/uber-review`: that pipeline checks code-vs-spec after build; this one checks spec-vs-reality before build.

**The rubric is the design-hazards worksheet** — `.agents/skills/shared/design-hazards.md`, the six ways a design here has been wrong, each demanding an artifact the spec must carry. The review's first question, before any lens runs: **is each row filled with evidence, or with assertion?** A row filled from memory is the form every one of the six took when it shipped.

This file is your playbook. Lens prompts live in `prompts/` next to it.

## Inputs

- Positional `<doc-path>` (required) — the spec to review, e.g. `docs/planned/supply-response.md`. If missing or not a readable markdown doc, exit with a clear message.
- `--effort=quick|standard|deep` — default `standard`.

## When to run / when to skip

- **Run** on specs with real cross-mechanic surface: economy changes, tick processors, anything that adds/changes/removes signals, formulas, thresholds, or triggers that shipped mechanics consume.
- **Skip** pure-UI slices and tooling changes — there is nothing for the consumer sweep to sweep. Say so rather than running a hollow review.
- **Slot**: after the spec is written and the user has approved it, before `/build-plan`. Once per feature.

## Effort dial

| Effort | Dispatch | Model / effort |
|--------|----------|----------------|
| `quick` | 1 agent carrying all three lens briefs concatenated | per surface tier, capped at Sonnet `high` |
| `standard` (default) | 3 parallel agents, one per lens | per surface tier, at `high` |
| `deep` | 3 parallel agents, one per lens | Opus at `xhigh` — opt-in escalation only |

**Surface tier** — decided from the spec before dispatch, stated in the report header:

- **Cross-mechanic** — the spec touches two or more tick processors, or adds/changes/removes any signal, formula, threshold or constant that a shipped mechanic consumes: all three lenses on **Opus**. This is the surface the skill exists for; never downgrade it to save tokens.
- **Bounded** — one mechanic, or harness/instrument-only work, with no shared-signal changes: lenses on **Sonnet**. (Pure-UI and tooling specs skip the review entirely — see "When to run".)

**State model and reasoning effort explicitly on every dispatch — never inherit the session's effort.** Resolve tier names through `.agents/model-tiers.md`. If the harness cannot choose a model per subagent, preserve the dispatch shape and verification requirements with the available agents.

## Severity rubric

- `critical` — the spec as written builds the wrong thing: it breaks shipped behaviour, deadlocks/oscillates/runs away dynamically, or contradicts itself on a load-bearing point.
- `major` — missed scope that requires a spec amendment: an unaccounted consumer, an unnamed interaction with a shipped mechanic, an unhandled state. **An in-scope worksheet row that is missing or assertion-filled is automatically `major`** — reaching implementation with an unfilled row is the process failure the worksheet exists to prevent.
- `minor` — clarification-level: ambiguity or a gap that planning could plausibly resolve without redesign.

## Pipeline

### 1. Audit the worksheet — the first question

Read the spec doc **in full**, then classify each of the six hazard rows:

- **evidence** — the artifact the row demands is present: pasted `npm run impact` output, `file:line` citations, numbers carrying horizon + cohort.
- **assertion** — the row is filled, but from memory: a readers table with no `file:line`, a claim with no number, "considered, no issue". Treat as unfilled.
- **missing** — the row isn't there at all.
- **out of scope** — only by the worksheet's own scope rule (pure-UI/tooling fills rows 3 and 6 only). Since /spec-review skips pure-UI specs, expect all six in scope.

The classification is a **required table in the report**, and it aims the lenses in step 3. It never bounces the review: a spec with six missing rows gets the most useful review of all — the lenses produce the missing artifacts themselves, and filling the worksheet becomes the amendments.

**Falsifier check — audit the diff, not the intention.** Locate the evidence the spec rests on: the spec's own evidence section, or the feature's working file (`docs/build-plans/<feature>.md`, `## Evidence`). Then find the falsifier's **first entry into history anywhere** — evidence migrates between files (roadmap row → working file → spec), and a log scoped to the current file reads a migration commit as authorship:

```
git log --oneline -S Falsifier -- docs/   # docs-wide: the falsifier's true first commit (unscoped also matches the skill files themselves)
git log --oneline -- <file>               # where the evidence and conclusion landed
git show <first-sha>                      # the falsifier as originally committed
```

A well-kept file carries its own provenance line ("committed at `<sha>`, moved here unedited") — verify it rather than trusting it. The verdict compares the falsifier's first commit against the conclusion's first commit, and the falsifier's original text against the spec's current text. One line in the report:

- **pre-committed** — the falsifier entered history before the conclusion, and its current text matches `git show <first-sha>`.
- **edited after commit** — the current text differs from the first-committed text. The diff goes to the consistency lens as a finding. This has been caught here once already — a falsifier quietly condensed during write-up.
- **written alongside** — falsifier and conclusion first appear in one commit. Not fatal, but a falsifier written after the number exists is not a falsifier; the `Licenses` line gets extra scrutiny.
- **absent** — every current-behaviour claim in the spec is an untested hypothesis unless row 4 evidences it individually.

### 1a. Checkable sentences — every one, anywhere in the doc

Any sentence stating how the game works **today**, or naming a quantity the feature will use, is a
checkable claim, no matter where it sits — headline, rationale, a caveat, an aside inside a hazard
row, a cell in a table. Build the list while reading the spec in full, and hand it to the lenses
beside the worksheet audit. Each sentence is one of three kinds:

- **mechanic** ("X is computed per cycle", "the allocator fills worst-first") — must match the
  code; verified with `file:line`.
- **observation** ("measured as bimodal at Gate 1") — must name the measurement it came from, and
  must be worded as an observation, never as a mechanism. An observed distribution written in
  mechanism language ("the 0-or-1 cliff") is a finding by itself: the next reader will quote it as
  a rule of the game.
- **requirement** ("sorts by ROI", "ranked worst first", "clears by decay", "counts systems, not
  instances") — names a quantity the feature intends to *use*. Each one must resolve to a producer:
  an existing `file:line`, or an explicit statement that it is new authoring / new instrumentation
  with the emission specified. **A requirement that resolves to nothing is a blocker finding**, not
  a detail for planning to settle.

**The third kind is the one this check was extended for, and it is the easiest to read past.** The
first two are claims about what exists, so a reviewer instinctively goes looking. A requirement
names a quantity that does not exist yet by definition, and when it is phrased as a concept —
"ROI", "impact", "severity", "necessity" — there is no identifier to search for, so nothing prompts
the check and the sentence sails through on grammar alone. One feature shipped four of these in one
spec: "sorts by ROI" twice, "sorts by the ROI of what was dropped", and "clears by decay", against
a codebase with no ROI figure in the named services and a decay path structurally unable to see the
condition. Every one passed a full review here, was copied into a build-plan `Interface` line
unchanged, and surfaced at implementation as a question the owner had to answer mid-build — each
costing a spec amendment, a plan amendment, and a re-review of the parts not yet built.

The tell is that the measures which were already field names (`supplyBand`, `popCap`,
`STRIKE_PARAMS.threshold`) all carried receipts and none of them failed. **What could be grepped was
checked; what was phrased as a concept never was.** So read the sort-measure and clears-by columns
of any category or tier table noun by noun, not sentence by sentence.

Downstream, `/build-plan`'s resolution pass runs the same check before it writes tasks. That is the
backstop, not the primary net — catching it here is a conversation, catching it there is a re-plan.

A false side-remark is *more* dangerous than a false conclusion — conclusions get attacked by
every lens, while side-remarks get quoted in later design discussions as established fact. This
check exists because exactly that happened once: a wrong aside survived a full review inside a
correctly-hedged hazard row, then derailed the gate discussion built on top of it.

### 2. Map the spec

Read `docs/SPEC.md` (the system interaction map). Build two lists:

- **Changed primitives** — every signal, field, formula, threshold, or trigger the spec adds, changes, or removes. Row 1/row 5 tables classified `evidence` are your starting list; where those rows are weak, build it from the spec text yourself.
- **Touched mechanics** — every shipped mechanic the spec names, plus shipped mechanics it plausibly interacts with but does not name (the worksheet's row-3 system table + the SPEC.md interaction map enumerate the candidates).

### 3. Write the per-lens sharpening

Each lens owns specific hazard rows:

| Lens | Rows |
|---|---|
| consumer-sweep | 1 (one quantity, several jobs), 2 (constant misread), 5 (primitive that doesn't exist) |
| interaction-attack | 3 (a system you did not think about) |
| consistency-attack | 4 (claims without measurement), 6 (aggregate moves for other reasons), + spec-internal contradiction and stability, + the step-1a checkable-sentence list (mechanic sentences vs code, observation sentences vs their measurement, **requirement sentences vs a named producer** — a sort measure or clears-by resolving to nothing is a blocker, not a note) |

For each lens, write a 2–4 sentence attack framing **specific to this spec**, derived from the audit and the two lists. A row classified `assertion` or `missing` is that lens's primary target — it will produce the row's artifact itself and attack the spec with it; a row classified `evidence` gets spot-checked for completeness instead. Beyond the rows, aim at the spec's probable blind side — identify which *side* of each mechanism the spec redesigns and point the lens at the other side, e.g. "this spec redesigns the push side of each loop — sweep the receiving/clamping consumers whose triggers were previously synonymous with pathology." The sharpening never tells the lens what to conclude.

### 4. Dispatch the lens agents

**Standard / deep**: dispatch three independent general-purpose agents **in parallel** when the harness supports it, using the tier from the effort dial. Each agent's prompt, in order:

1. Contents of its lens prompt — `prompts/consumer-sweep.md`, `prompts/interaction-attack.md`, or `prompts/consistency-attack.md`
2. `## Spec-specific sharpening` — that lens's sharpening from step 3
3. `## Spec under review` — the doc path (the agent reads it in full)
4. `## Changed primitives` — the list from step 2
5. `## Worksheet audit` — the step-1 classification of the rows this lens owns; for the consistency lens, also the falsifier verdict

**Quick**: dispatch one `strong` agent whose prompt concatenates all three lens prompts under clear separators, followed by the sharpenings, doc path, primitives list, and the full audit. Note in the report that the convergence signal is unavailable in quick mode.

Each agent returns JSON in a fenced block (schema in the lens prompts). Parse with the same fenced-block regex + retry-once policy as `/uber-review`: on malformed output, re-dispatch once appending "Your previous response was malformed. Return ONLY a JSON object in a ```json fenced block." If still malformed, drop that lens with a warning in the report.

### 5. Verify and merge

- **Spot-verify every `critical` and `major` finding yourself** — open the cited files and confirm the load-bearing claim before accepting it. A finding that does not survive verification is **dropped into the audit trail**, never silently discarded and never reported as real.
- **Convergence**: two lenses independently reporting the same underlying issue → merge and mark **high-confidence** (this is the strongest signal the process produces).
- **Dedup by judgment** — pools are small; merge same-issue findings across lenses yourself. No dedup agents.

### 6. Report

Save to `.agent-reviews/spec-<docname>-<YYYY-MM-DD-HHmmss>.md` (create `.agent-reviews/` if missing — it is gitignored) and print a terminal summary.

```markdown
# /spec-review — <doc-path>

- **Timestamp**: <ISO timestamp>
- **Effort**: <effort>
- **Lenses**: <3 parallel | 1 combined (quick)>

## Worksheet audit

| Row | Hazard | Status | Basis |
|---|---|---|---|
<one row per hazard: evidence / assertion / missing / out of scope, with what is (or isn't) in the row>

Falsifier: <verdict from step 1, with the commit shas it rests on>

## Findings

<grouped critical → major → minor; per finding:>
- **<severity>** [<lens(es)>] <hazard row if any> <high-confidence flag if convergent> — <plain-terms claim>
  - Evidence: <file:line + snippet/reasoning>
  - Verification: <what the orchestrator confirmed in code>
  - Proposed amendment: <concrete spec change, ready to apply>

## Refuted angles

<per angle:>
- [<lens>] <angle attempted> — <why it does not hold, with evidence>

## Audit trail

- Dropped findings (failed orchestrator verification): <claim + why dropped>
- Per-lens stats: <findings / refuted angles / approx tokens if visible>
```

Terminal summary: the worksheet audit verdict in one line (e.g. "3 of 6 rows evidence, falsifier pre-committed"), counts by severity, the high-confidence findings called out, and the report path.

### 7. Triage gate — REQUIRED, blocking

Present each finding and ask the user to call it:

- **Accept** — the spec gets amended with the proposed amendment.
- **Reject** — intended behaviour or wrong finding; record the call in the report.
- **Defer** — real but out of scope; **book it** (into `docs/ROADMAP.md` or the spec's own open-questions section) before moving on — a deferred finding with no booked destination is a dropped finding.

Do not touch the spec until the user has called every finding.

### 8. Apply

Edit the spec doc with **only** the accepted amendments. Show the user the diff. Update the report with the triage outcomes. The spec then proceeds to `/build-plan`.

## Error handling

- Doc path missing/unreadable → exit early with a friendly message.
- A lens agent fails twice → proceed with remaining lenses; warn in the report.
- No findings at all → that is a valid outcome; the refuted-angles section is the deliverable. Never pad.
