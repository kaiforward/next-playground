# How should pricing affect internal logistics?

**Status: an open design question, not a design.** Nothing here is decided. This file exists so a new
session can pick the discussion up without re-deriving it, and so the measured facts stay separated
from the reasoning built on top of them.

Transient (build-plan lifecycle): delete when the question is settled, carrying the decision into
`docs/active/gameplay/economy-autonomic-agency.md` and anything killed into the `killed-designs` memory.

---

## The question in one line

Two thresholds that gate *physical* logistics behaviour — when a world stops producing, and when it is
willing to give goods away — are both measured against a **pricing** reference, and nobody chose that.

## Why it is a question at all

There are two different "how much should sit here" numbers, and they answer different questions:

| | What it means | Denominator |
|---|---|---|
| `targetStock` | the **price** anchor — where the good prices at par | `demandRate`, floored at `MIN_DEMAND` |
| `logisticsTarget` | the **warehousing** target — what this world tries to keep on hand | real demand, unfloored |

`MIN_DEMAND` is a divide-by-zero guard whose own docstring calls it a floor on the *pricing*
denominator. It was never authored to describe need.

#211 moved the **deficit** side (who needs goods) onto `logisticsTarget`. Of the two readers left on
the price anchor at that point, one remains and is the subject of this question:

- **The production brake** — `productionCeiling` stops output at `HOLD_COVER × targetStock`.
- ~~**The generosity rule**~~ — shipped out in #212 (`DONOR_RESERVE_COVER`); the item-5 role split
  then removed the anchor from the logistics data path entirely (`GoodMarketState` no longer carries
  `targetStock`; `surplusDrawable`'s dead `targetStock ≤ 0` guard is deleted).

## What is measured

From [hold-cover-surplus-margin.md](./hold-cover-surplus-margin.md) — 600 systems, seed 42,
`ECONOMY_SCALE=100`, 10,000 ticks, counted inside the matcher, cross-checked against `flowEvents`:

- The generosity rule **does** fire: 2.91% of hauls at startup, 1.82% at equilibrium.
- 95% of those donors held stock **no delivery could have supplied** — made, not given. The roadmap's
  original premise (a self-supplier can only re-donate what it was given) is backwards.
- ~1% of ordinary-path checks sit in the gap between the brake (1.3×) and the generosity line (1.4×).

## What is NOT measured — do not build on these

- **Dwell time in the gap.** Occupancy was counted per evaluation; that is a churn metric. Whether a
  market passes through in a cycle or sits there is unknown.
- **Which route lifts a market over 1.4×** — own production overshooting the brake, versus the anchor
  shrinking underneath it (an `anchorMult` event, or demand decline).
- **The other two callers of `surplusDrawable`** — the build input-supply gate and the colony founding
  manifest. Only the logistics matcher was measured. Both callers have since been re-pointed at
  demand-denominated figures (#212 and the item-5 role split), but re-pointed is not measured — no
  count of how often either fires exists.
- **Anything about what changing `HOLD_COVER` would do.** `npm run impact` puts it in
  `economy`/`industry`/`tick` — it throttles production galaxy-wide, not just this donor edge.

## Two corrections made during the discussion — keep them

Both were assistant errors caught by Kai; they are recorded because the wrong versions are plausible
and would otherwise be re-derived.

1. **Logistics does consider external need.** The matching stage is entirely driven by it — shortages
   are collected across systems, sorted worst-first, and matched to the nearest world with spare. What
   external need cannot do is move the *threshold* at which a world counts as having spare. It decides
   whether spare is used and where it goes; it cannot create spare in a world below its own line.
2. **No world has zero demand for a good.** `GOOD_CONSUMPTION` carries a per-capita civilian rate for
   every good, ore included. Stock therefore always drains and the gap is transient, not a permanent
   lock. The floor only takes over where real consumption sits under it — small worlds, and higher-tier
   goods at larger populations (~25 pop for ore, ~50 for electronics, ~167 for ship frames).

## What the discussion has to decide

Open, in rough dependency order. **No options are proposed here on purpose** — the last three times a
direction was picked before the evidence, it cost a PR.

1. Should the production brake reference the price anchor at all, or move to a demand-denominated
   figure the way the deficit, donor, and founding sides already did? (It is the last physical reader —
   the generosity rule moved in #212 and the item-5 role split took the anchor out of the logistics
   data path entirely.)
2. If it moves: what happens on markets whose real demand is under the floor? The anchor's `MIN_DEMAND`
   floor is currently what keeps the brake's knee finite there. A demand-derived knee of 0 for a pure
   exporter would make `productionCeiling` return 0 at any stock — production halted outright, the
   brake-side mirror of the donor-side trap that died with `surplusDrawable`'s guard (there, demand 0
   correctly meant *everything is drawable*; here it would mean *nothing may be produced*).
3. Should the brake and the generosity line share one owner, or is a deliberate gap between them wanted?
   The measurement kills the "it never fires" argument for collapsing them, so the case has to be made
   on design grounds instead.
4. Does price belong in the logistics decision in some *other* form — as a signal about where goods are
   wanted, rather than as the yardstick for how full a warehouse is?

## Inputs noted for the discussion (not options, not decisions)

- Kai, 2026-08-03: the matcher's sink ordering (severity = shortfall × demand, worst-first) is
  itself design space — e.g. scaling need by relative size so a tiny/new colony's request can
  outrank raw tonnage, and giving the player a mechanical lever over flow priority. Explicitly
  separable from the donor-side reserve change (which only alters how much a market may *give*,
  never who is *served* first) and not scoped into it.
- Kai, 2026-08-03 (during donor-reserve verification, prompted by the ship_frames empty-tail
  finding): the deeper problem is upstream of flow priority — colonisation is far too generous
  (the AI founds essentially everything by ~tick 500, and those colonies then leech for thousands
  of ticks: served last, growing slowly, with little capacity to lift themselves out). Direction,
  stated as opinion not decision: make colonisation resource-aware; make production planning
  consider global faction/market needs rather than purely local ones; plus the other queued fixes.
  The chronic marginality of mid-size consumers on thin chains (ship_frames especially) is a
  symptom of this, not of the logistics rules alone.
- Kai, 2026-08-03 (after the long-horizon stability read): now that monetary mechanics exist,
  **systematically remove anything that is still free.** The code marks several such quantities
  itself: the logistics work budget ("free, population-scaled in v1"), the per-pop construction
  pool base, cheap claims, a founding manifest that costs goods but no money. Colonisation in
  particular should be a major undertaking in the Stellaris mould — very expensive and resource
  intensive — which is also the structural fix for the leech-colony pattern above (founding
  everything by ~t500 stops being possible when each colony must be provisioned and paid for).
  Stated as direction; the audit itself reads roadmap-worthy and awaits Kai's placement in the
  queue.

## Related roadmap items

Item 4 (exporter price pinning) moved to the unqueued goods-pricing revisit on 2026-08-03 — pricing
rework waits for pop wages or inter-faction trade. Item 1 (the donor side) shipped as #212 — the
generosity rule now reads `DONOR_RESERVE_COVER`. Item 2 closed 2026-08-03 as chosen conservatism
(the [1.3, 1.4)× self-supplier lock is intended; see memory `killed-designs`) — **which makes this
session the sole owner of the brake-denominator question**. Item 5 (`TARGET_COVER` carrying three
roles) shipped: the founding fill target is `FOUNDING_STOCK_COVER` cycles of raw demand, the
harness surplus metric reads the donor line, and no logistics or planner code touches the anchor.
`productionCeiling`'s `HOLD_COVER × targetStock` is now the *only* physical mechanism measured
against the price anchor, and question 1 above reduces to it alone.
