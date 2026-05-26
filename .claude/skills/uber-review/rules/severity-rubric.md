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
