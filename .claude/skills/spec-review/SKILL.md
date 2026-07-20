---
name: spec-review
description: Adversarial multi-agent review of a feature spec against the existing codebase. Use when the user runs /spec-review <doc-path>, or when an approved spec with cross-mechanic surface (economy, tick processors, changed signals or primitives) is about to go to implementation planning.
---

# /spec-review — Adversarial spec review

You are orchestrating an adversarial review of a **feature spec** against the **existing codebase** — before any code is written. This is the counterpart to `/uber-review`: that pipeline checks code-vs-spec after build; this one checks spec-vs-reality before build. The misses it targets: scope the spec doesn't know it's missing, shipped mechanics it silently interacts with, and contradictions or failure modes inside its own design.

This file is your playbook. Lens prompts live in `prompts/` next to it.

## Inputs

- Positional `<doc-path>` (required) — the spec to review, e.g. `docs/planned/economy-band-reconciliation.md`. If missing or not a readable markdown doc, exit with a clear message.
- `--effort=quick|standard|deep` — default `standard`.

## When to run / when to skip

- **Run** on specs with real cross-mechanic surface: economy changes, tick processors, anything that adds/changes/removes signals, formulas, thresholds, or triggers that shipped mechanics consume.
- **Skip** pure-UI slices and tooling changes — there is nothing for the consumer sweep to sweep. Say so rather than running a hollow review.
- **Slot**: after the spec is written and the user has approved it, before `writing-plans`. Once per feature.

## Effort dial

| Effort | Dispatch | Model |
|--------|----------|-------|
| `quick` | 1 agent carrying all three lens briefs concatenated | sonnet |
| `standard` (default) | 3 parallel agents, one per lens | opus |
| `deep` | 3 parallel agents, one per lens | fable |

## Severity rubric

- `critical` — the spec as written builds the wrong thing: it breaks shipped behaviour, deadlocks/oscillates/runs away dynamically, or contradicts itself on a load-bearing point.
- `major` — missed scope that requires a spec amendment: an unaccounted consumer, an unnamed interaction with a shipped mechanic, an unhandled state.
- `minor` — clarification-level: ambiguity or a gap that planning could plausibly resolve without redesign.

## Pipeline

### 1. Map the spec

Read the spec doc **in full**, plus `docs/SPEC.md` (the system interaction map). Build two lists:

- **Changed primitives** — every signal, field, formula, threshold, or trigger the spec adds, changes, or removes.
- **Touched mechanics** — every shipped mechanic the spec names, plus shipped mechanics it plausibly interacts with but does not name (use the SPEC.md interaction map to enumerate candidates).

### 2. Write the per-lens sharpening

For each lens, write a 2–4 sentence attack framing **specific to this spec**, derived from the two lists. The sharpening points the lens at the spec's probable blind side; it never tells the lens what to conclude. The shape that works: identify which *side* of each mechanism the spec redesigns, and aim the lens at the other side — e.g. "this spec redesigns the push side of each loop — sweep the receiving/clamping consumers whose triggers were previously synonymous with pathology."

### 3. Dispatch the lens agents

**Standard / deep**: dispatch three `general-purpose` agents **in parallel** (one Agent tool message), model per the effort dial. Each agent's prompt, in order:

1. Contents of its lens prompt — `prompts/consumer-sweep.md`, `prompts/interaction-attack.md`, or `prompts/consistency-attack.md`
2. `## Spec-specific sharpening` — that lens's sharpening from step 2
3. `## Spec under review` — the doc path (the agent Reads it in full)
4. `## Changed primitives` — the list from step 1

**Quick**: dispatch one sonnet agent whose prompt concatenates all three lens prompts under clear separators, followed by the sharpenings, doc path, and primitives list. Note in the report that the convergence signal is unavailable in quick mode.

Each agent returns JSON in a fenced block (schema in the lens prompts). Parse with the same fenced-block regex + retry-once policy as `/uber-review`: on malformed output, re-dispatch once appending "Your previous response was malformed. Return ONLY a JSON object in a ```json fenced block." If still malformed, drop that lens with a warning in the report.

### 4. Verify and merge

- **Spot-verify every `critical` and `major` finding yourself** — open the cited files and confirm the load-bearing claim before accepting it. A finding that does not survive verification is **dropped into the audit trail**, never silently discarded and never reported as real.
- **Convergence**: two lenses independently reporting the same underlying issue → merge and mark **high-confidence** (this is the strongest signal the process produces).
- **Dedup by judgment** — pools are small; merge same-issue findings across lenses yourself. No dedup agents.

### 5. Report

Save to `.claude/reviews/spec-<docname>-<YYYY-MM-DD-HHmmss>.md` (create `.claude/reviews/` if missing — it is gitignored) and print a terminal summary.

```markdown
# /spec-review — <doc-path>

- **Timestamp**: <ISO timestamp>
- **Effort**: <effort>
- **Lenses**: <3 parallel | 1 combined (quick)>

## Findings

<grouped critical → major → minor; per finding:>
- **<severity>** [<lens(es)>] <high-confidence flag if convergent> — <plain-terms claim>
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

Terminal summary: counts by severity, the high-confidence findings called out, and the report path.

### 6. Triage gate — REQUIRED, blocking

Present each finding and ask the user to call it:

- **Accept** — the spec gets amended with the proposed amendment.
- **Reject** — intended behaviour or wrong finding; record the call in the report.
- **Defer** — real but out of scope; **book it** (into `docs/BACKLOG.md` or the spec's own open-questions section) before moving on — a deferred finding with no booked destination is a dropped finding.

Do not touch the spec until the user has called every finding.

### 7. Apply

Edit the spec doc with **only** the accepted amendments. Show the user the diff. Update the report with the triage outcomes. The spec then proceeds to `writing-plans`.

## Error handling

- Doc path missing/unreadable → exit early with a friendly message.
- A lens agent fails twice → proceed with remaining lenses; warn in the report.
- No findings at all → that is a valid outcome; the refuted-angles section is the deliverable. Never pad.
