# Colonisation economics — founding-economics baseline (roadmap row 10)

Working file for the row-10 `/measure` baseline. Row: founding stops being free — claims, establish
projects and founding manifests carry real monetary and goods cost, and the AI founding policy prices
colonies against its treasury. Before any design exists, this file pins what founding actually costs
and paces **today**, so the cost model is authored against measured scales, not intuition.

Transient like any build plan: deleted when row 10 ships, durable readings carried into the active
docs or `killed-designs`.

## Claims and falsifiers

Written and committed before any instrument runs. Each claim is about current behaviour; each
falsifier is in the units and at the horizon the measurement will use.

### C1 — Founding cadence: everything founds early

**Claim:** The AI founding policy founds essentially every system it will ever found early in a run —
the large majority (>80%) of colonies ever founded by t=10,000 already exist by t≈500–1000, and the
equilibrium founding rate is near zero because the galaxy is saturated, not because founding is gated
by anything scarce.

**Falsifier:** If >20% of a run's total foundings happen after t=2,000, or the cumulative founding
curve is still climbing materially at equilibrium, founding pacing already has structure and the
row's "founds essentially everything by ~t500" premise is wrong — the cost model would then be
reshaping an existing pacing mechanism, not creating one.

### C2 — Monetary cost: founding debits nothing

**Claim:** Founding a colony debits no treasury account. No claims charge, no establish-project
charge, no manifest purchase — the manifest is goods moved from founder stock
(`directed-build.ts` folds `stockManifest` into stock; the tonnage is tracked "for the calibration
harness only"). The only treasury-adjacent founding cost is work billed through the logistics /
construction bands, which founding barely moves.

**Falsifier:** Any code path that debits a `WorldFactionTreasury` balance on claim, establish or
founding, found by the impact/code sweep — or a treasury settlement line that moves with founding
events at the startup horizon. Either kills "monetarily free" and the design starts from re-pricing
an existing charge instead of introducing one.

### C3 — Treasury headroom: any plausible price would not bind

**Claim:** During the founding era (t ≤ 1,000), faction treasuries run a structural surplus — median
faction balance is positive, growing, and equivalent to multiple cycles of that faction's total
per-cycle spend (maintenance + logistics + construction), and the funding ladder latches at or near
1.0 (no band runs short). Consequence if true: a per-colony price must be authored at a deliberate
scale (a meaningful fraction of a cycle's spend or more) to bind at all; a token price changes no
founding decision.

**Falsifier:** If founding-era treasuries sit near zero, or any settlement band latches materially
below 1.0 for the median faction, treasuries are already tight and *any* colony price bites
immediately — the design question becomes sequencing against existing bills, not authoring a price
big enough to notice.

### C4 — The founder's goods cost is transient (the `founderCoverAfter` question)

**Claim:** The measured ~0.29–0.30× median founder cover after seeding a manifest (562/562 real
samples, post-fix — see `honest-demand-thread` memory) is a transient depression: founder markets
recover to their role-cohort norm within the startup transient (~300+ cycles) and show no lasting
depression vs cohort at equilibrium.

**Falsifier:** If founder markets remain measurably below their role-cohort norm at equilibrium
(10k; 12k for high-tier goods per the stage-3 gate convention), founding already carries a lasting
*physical* cost today — the row's premise sharpens from "founding is free" to "founding is
monetarily free but physically costly", and the cost model must price against that, not on top of it
as if it were zero.

### C5 — Leech-colony baseline: the pattern row 10 exists to fix

**Claim:** A material share (>25%) of colonies founded in-run land in the struck / served-last
cohort and are still there at equilibrium — the leech-colony pattern (#212's documented cost,
`economy-autonomic-agency.md`) that "fewer, deliberate colonies" is meant to fix structurally.

**Falsifier:** If in-run colonies are mostly healthy at equilibrium (struck share ≤10%, in line with
seeded worlds), the leech-colony motivation is weaker than assumed and the row's aim needs
re-justifying before a cost model is designed around it.

### A1 — The everything-free audit (sweep, not a number)

Enumerate every founding-adjacent resource flow and record whether it is priced, budgeted, or
physically bound today: claims, establish projects, founding manifests, the logistics work budget,
the per-pop construction pool base. Already measured, cite don't re-measure: the haul budget never
binds (~6–8% spent, 2026-08-04) — pricing it changes no flow unless deliberately authored to bind.

## Instruments

- C1, C4, C5 — `npm run simulate`, both horizons, cohorted (foundingStock covers the in-run colony
  cohort; founder recovery read against role cohort). Founding timeline per cycle may need a scratch
  diag in `.superpowers/` — validate its count against the harness's own founded-colonies figure.
- C2, A1 — code sweep + `npm run impact` on the treasury write path and founding path. No sim needed
  unless a charge is found.
- C3 — harness treasury reporting if it exists; else a scratch diag reading `WorldTreasurySettlement`
  per cycle, validated against the bands' latched funding fractions as the independent signal.

## Evidence

(To be filled from the instrument runs — six-field frame per claim, raw cohorted rows verbatim.)
