# `HOLD_COVER` vs `SURPLUS_MARGIN` — the donor lock

Working file for ROADMAP item 2. Transient: delete when the item ships, carrying anything durable into
the active doc or the `killed-designs` memory first.

## Evidence — **FALSIFIED** (`/measure`, 2026-08-03)

**Claim:** the ordinary-donor branch of `surplusDrawable` (taken when `production ≤ demand`, or when
production is suppressed; requires `stock ≥ SURPLUS_MARGIN × targetStock`) sources zero directed-logistics
hauls, because `productionCeiling` halts own-production at `HOLD_COVER × targetStock` and 1.3 < 1.4.
Both functions read the SAME `targetStock` — the price anchor `TARGET_COVER × demandRate × anchorMult`
(`marketBandForRow`), confirmed at `lib/engine/tick.ts:77` and `lib/engine/directed-logistics.ts:96-99`.

**Falsifier, committed before the run:**
- *Any* haul sourced from the ordinary-donor branch falsifies "never fires" — the bar is a hard zero,
  at both 1,000t and 10,000t.
- Separately, if that branch sources **≥ 1%** of hauls by count at either horizon, "the margin is
  decorative" is also false and item 2 must be re-scoped rather than resolved by giving the two
  constants one owner.
- A run in which no (system, good) pair *ever* sits above `1.0 × targetStock` on the ordinary path is
  **inconclusive**, not confirmatory: the branch would be unreached for an unrelated reason and the
  instrument has not tested the claim.

Secondary reading, same run (attribution, not a pass/fail): of any hauls the branch does source, the
share whose donor stock arrived by delivery/founding vs. by own production, and the occupancy of the
`[1.3, 1.4) × targetStock` dead band — the population that raising `HOLD_COVER` to `SURPLUS_MARGIN`
would unlock.

*The claim and falsifier above were committed in `docs/ROADMAP.md` at `12fa9f62`, before the instrument
ran, and moved here unedited. `git show 12fa9f62` is the audit.*

**Number:** the branch fires. **2.91%** of hauls at startup (734 of 25.2K), **1.82%** in the equilibrium
window (1.9K of 104.4K), 1.26% whole-run (14.1K of 1.12M); by volume 2.09% / 3.26% / 1.83%. Both
falsifier bars are tripped at both horizons.

**Horizon:** startup = cumulative ticks 1–1,000; equilibrium = ticks 9,001–10,000 as its own window
(not a cumulative read — the startup transient is excluded rather than averaged in).

**Cohort:** all systems and all goods, 600 systems, seed 42, `ECONOMY_SCALE=100`, split by donor branch
(exporter vs ordinary). **Not** cohorted by good or world cohort — see Licenses.

**Instrument:** counting *inside* `matchFactionTransfers`, classifying the branch on the same object the
matcher reads in the same tick. Not a pre-tick snapshot: `.superpowers/donor-diag.ts` attributes hauls to a
snapshot taken before the tick, and logistics runs near the end of one. Validity check: directed-logistics
is the only writer of `flowEvents`, so attributed hauls must equal flow events — **1.12M vs 1.12M, match**.
The counting hook was a temporary patch to `lib/engine/directed-logistics.ts`, reverted after the run
(`git status` clean, no residual references).

**Licenses.** Supports: "never fires" and "decorative" are both dead, at both horizons; and there is a
genuinely locked band at `[1.3, 1.4) × targetStock` — 1.13% of ordinary-path evaluations at equilibrium,
470 distinct (system, good) pairs in the last 1,000 ticks, 3,277 over the run. That band is the real
defect: production halted, donation refused, exit only downward.
Does **not** support: (a) the roadmap row's mechanism story — 95% of ordinary-branch hauls came from donors
whose `logisticsTarget < 1.4 × targetStock`, i.e. *no logistics delivery could have lifted them over the
line*, so the surplus was overwhelmingly **made, not given**, the reverse of what the row asserts;
(b) any claim about *which* non-delivery route put that stock there — own-production overshoot past the
1.3 ceiling and a shrinking anchor (`anchorMult` drop, demand decline) were not separated, and the colony
founding manifest is a delivery route this split does not test; (c) any prediction about what raising
`HOLD_COVER` would do — `npm run impact` puts it in `economy`/`industry`/`tick`, so it throttles production
galaxy-wide, not just this donor edge; (d) anything about the other two `surplusDrawable` callers (build
planner, founding manifest) — only the logistics matcher was measured. That is item 1, still open.

**Direction (one sentence, no design):** the two constants are not the whole story — the surviving
finding is the locked `[1.3, 1.4)` band, and the next question is which route feeds the ordinary branch,
not whether it fires.

### Why the branch fires at all

`surplusDrawable` branches on *realized* production, which `productionCeiling` drives toward zero as stock
approaches `1.3 × targetStock`. A producer filling up therefore demotes itself off the exporter branch onto
the ordinary one — and usually arrives already above `1.4 ×`, because one production increment from the
anchor can exceed the whole band (`production > 0.4 × targetStock` clears it in a single step). It is a
handoff, not a lock. The lock is only for those that land inside `[1.3, 1.4)`.

### Open question this evidence does not answer

Which route lifts an ordinary-path market over `1.4 × targetStock`: own-production overshoot, or a
shrinking `targetStock` (`anchorMult` event, demand decline)? The fork matters — overshoot means the
system broadly works and the gap is a rough edge; a shrinking anchor means donations are driven by the
yardstick moving rather than by anyone holding real spare. Not measured; one more 10,000-tick run.

<details><summary>Raw output — <code>.superpowers/branch-diag.ts</code>, 600 systems, seed 42, 10,000 ticks</summary>

```
branch-diag — /measure roadmap item 2
  600 systems, seed 42, 10000 ticks
  ECONOMY_SCALE = 100   (must be 100 to match the game; 1 means .env did not load)
  HOLD_COVER = 1.3, SURPLUS_MARGIN = 1.4

==============================================================================
STARTUP HORIZON — cumulative ticks 1-1000
==============================================================================
  HAULS SOURCED
    exporter branch (production > demand) :    24.5K    97.09%
    ORDINARY branch (SURPLUS_MARGIN gate) :      734     2.91%   <-- the claim
    total                                 :    25.2K
  VOLUME SOURCED
    exporter branch                       :    4.26M    97.91%
    ORDINARY branch                       :    91.1K     2.09%
  ORDINARY-PATH OCCUPANCY (stock / targetStock, per evaluation)
    < 1.00  (below anchor, no surplus)    :    83.6K    97.30%
    1.00-1.30 (dead band, under HOLD)     :     1.4K     1.68%
    1.30-1.40 (THE GAP: production halted,
               donation still refused)    :      234     0.27%   <-- what raising HOLD_COVER unlocks
    >= 1.40 (clears the margin)           :      645     0.75%
    distinct (system,good) pairs seen in 1.30-1.40 : 126
    distinct (system,good) pairs seen >= 1.40      : 323
  ORDINARY DONORS THAT SHIPPED — where their stock could have come from
    logisticsTarget >= 1.4 x targetStock  :       31   (a delivery alone can lift them over: "given", not "made")
    logisticsTarget <  1.4 x targetStock  :      703   (no delivery can: own production or a shrinking anchor)
    suppressed ex-exporter                :        0   (struck producer on the ordinary path)
  CONFOUND
    skipped as a deficit sink while already >= 1.40 x targetStock :        0

==============================================================================
EQUILIBRIUM WINDOW — ticks 9001-10000 only (the last 1000, startup excluded)
==============================================================================
  HAULS SOURCED
    exporter branch (production > demand) :   102.5K    98.18%
    ORDINARY branch (SURPLUS_MARGIN gate) :     1.9K     1.82%   <-- the claim
    total                                 :   104.4K
  VOLUME SOURCED
    exporter branch                       :  125.54M    96.74%
    ORDINARY branch                       :    4.23M     3.26%
  ORDINARY-PATH OCCUPANCY (stock / targetStock, per evaluation)
    < 1.00  (below anchor, no surplus)    :   318.1K    81.11%
    1.00-1.30 (dead band, under HOLD)     :    53.8K    13.72%
    1.30-1.40 (THE GAP: production halted,
               donation still refused)    :     4.4K     1.13%   <-- what raising HOLD_COVER unlocks
    >= 1.40 (clears the margin)           :    15.9K     4.04%
    distinct (system,good) pairs seen in 1.30-1.40 : 470
    distinct (system,good) pairs seen >= 1.40      : 487
  ORDINARY DONORS THAT SHIPPED — where their stock could have come from
    logisticsTarget >= 1.4 x targetStock  :        0   (a delivery alone can lift them over: "given", not "made")
    logisticsTarget <  1.4 x targetStock  :     1.9K   (no delivery can: own production or a shrinking anchor)
    suppressed ex-exporter                :       10   (struck producer on the ordinary path)
  CONFOUND
    skipped as a deficit sink while already >= 1.40 x targetStock :        0

==============================================================================
WHOLE RUN — cumulative ticks 1-10000
==============================================================================
  HAULS SOURCED
    exporter branch (production > demand) :    1.10M    98.74%
    ORDINARY branch (SURPLUS_MARGIN gate) :    14.1K     1.26%   <-- the claim
    total                                 :    1.12M
  VOLUME SOURCED
    exporter branch                       :  842.76M    98.17%
    ORDINARY branch                       :   15.72M     1.83%
  ORDINARY-PATH OCCUPANCY (stock / targetStock, per evaluation)
    < 1.00  (below anchor, no surplus)    :    3.51M    92.57%
    1.00-1.30 (dead band, under HOLD)     :   190.0K     5.02%
    1.30-1.40 (THE GAP: production halted,
               donation still refused)    :    22.2K     0.59%   <-- what raising HOLD_COVER unlocks
    >= 1.40 (clears the margin)           :    69.1K     1.82%
    distinct (system,good) pairs seen in 1.30-1.40 : 3277
    distinct (system,good) pairs seen >= 1.40      : 5006
  ORDINARY DONORS THAT SHIPPED — where their stock could have come from
    logisticsTarget >= 1.4 x targetStock  :       74   (a delivery alone can lift them over: "given", not "made")
    logisticsTarget <  1.4 x targetStock  :    13.4K   (no delivery can: own production or a shrinking anchor)
    suppressed ex-exporter                :      581   (struck producer on the ordinary path)
  CONFOUND
    skipped as a deficit sink while already >= 1.40 x targetStock :        4

==============================================================================
INSTRUMENT CROSS-CHECK
==============================================================================
  flowEvents written by the tick : 1.12M
  hauls attributed to a branch   : 1.12M
  MATCH — every haul the tick recorded was attributed to a branch.
```
</details>
