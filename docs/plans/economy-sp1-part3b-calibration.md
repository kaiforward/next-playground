# SP1 Part 3b — Pricing Calibration & Docs Cutover Plan

**Goal:** Calibrate the first-draft pricing constants shipped in Part 3a, then finish the documentation cutover so the active spec describes days-of-supply pricing (not the retired anchor).

**Context:** Part 3a (merged into `feat/economy-simulation` as squash commit `4c4aaac`) replaced the per-good calibrated anchor with `reference = TARGET_COVER × demandRate × anchorMult`, `price = basePrice × (reference / stock)^k`. `TARGET_COVER` (50), `MIN_DEMAND` (0.05), and the seed-cover band (`SEED_COVER_MIN`/`SEED_COVER_MAX` = 0.5 / 1.5) in `lib/constants/market-economy.ts` are first-draft placeholders. All pricing tests assert against the *imported* constants (never hardcoded literals), so they survive recalibration.

## Steps

1. **Calibrate `TARGET_COVER` (and, if needed, the seed-cover band) via `npm run simulate`.**
   - Known issue from the 3a coarse check: at `TARGET_COVER = 50` the greedy strategy sits ~99% idle — local price gradients are too flat for it to act on. (The optimal/nearest strategies still earn ~600K, so the economy *is* tradeable; greedy just can't see the local edge.) Tune `TARGET_COVER` so local gradients are actionable without pushing goods to the band edges.
   - Water/food run structurally dear at high population (accepted) — confirm this stays bounded after calibration.
   - Tune the constants only; do not touch the curve shape, elasticity, slippage, or spread.

2. **Rewrite the active economy doc.** `docs/active/gameplay/economy.md` still describes the retired global/per-good anchor. Replace those sections with the days-of-supply model: `reference = TARGET_COVER × demandRate × anchorMult`, `demandRate = max(perCapitaNeed × population, MIN_DEMAND)`, and cover-based seeding.

3. **Sweep pre-existing plan/phase comment references out of the codebase.** Project convention (`comment-references-plan`): code comments describe the code, never a build phase, PR number, sub-project, or migration stage. The Part 3a `/uber-review` surfaced that many *pre-existing* comments violate this — out of scope for 3a, bundled here. Known offenders (non-exhaustive, from a `Part 3|Phase \d|SP1|sub-project|PR3` sweep of `lib/`): `lib/engine/body-gen.ts`, `lib/engine/universe-gen.ts`, `lib/engine/faction-gen.ts`, `lib/constants/bodies.ts`, `lib/constants/substrate-gen.ts`, `lib/constants/events.ts`, `lib/constants/factions.ts`, `lib/constants/doctrines.ts`, `lib/tick/world/relations-world.ts`, `lib/types/api.ts`, `lib/types/game.ts`, and test files (e.g. `lib/engine/__tests__/universe-gen-invariants.test.ts`). Replace phase/PR/sub-project wording with plan-agnostic descriptions of what the code does, or drop it. (This plan doc itself may reference phases — the convention applies to *code* comments, not plan docs.)

4. **Delete the shipped 3a plan.** Remove `docs/plans/economy-sp1-part3a-emergent-pricing.md` — its feature is merged and the code is the source of truth.

## Tooling (bundled into this session)

5. **Add a documented merge flow to the `uber-review` skill** (`.claude/skills/uber-review/SKILL.md`). Doc-only — no new behavior, no auto-merge flag. Add an optional `## 9. Merging after review (PR mode)` section codifying the flow so it doesn't have to be re-explained each time:
   - Apply fixes for the accepted findings, then re-verify (`tsc` + the relevant test suites green).
   - **Pause and ask the user to sanity-check before merging** — explicitly call out any UI / visual / interaction changes the review and its agents can't validate, and request an explicit go-ahead.
   - Only once the user confirms: commit fixes to the PR branch + push; squash-merge into the base with a clean **atomic, feature-describing** commit message (subject + `--body-file`, no "address review"/merge/impl-detail noise, per the clean-history convention); fast-forward the local base branch; delete the merged phase branch (local + remote).

## Done when
- Simulator shows actionable local gradients (greedy materially out-earns random and trades regularly); stocks land within `[5, 200]`.
- `docs/active/gameplay/economy.md` describes days-of-supply pricing only.
- No plan/phase/PR/sub-project references remain in `lib/` code comments.
- `docs/plans/economy-sp1-part3a-emergent-pricing.md` is deleted.
- The `uber-review` skill documents the post-review merge flow (pause-for-sanity-check → confirm → finish).
