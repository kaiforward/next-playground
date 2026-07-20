# Player Seat Roadmap — Purse Follow-ons & The Alert Feed

> **Planned.** The remaining unbuilt pieces of the grand-strategy pivot's player-seat phase
> ([grand-strategy-vision.md](./grand-strategy-vision.md) §8 Phase 3). The seat (identity/entry),
> control + construction actualisation, and the purse (faction treasuries + effects + player
> surfaces) have shipped — see [player-seat.md](../active/gameplay/player-seat.md) and
> [player-seat-purse.md](../active/gameplay/player-seat-purse.md). What remains here: the purse's
> deferred-by-design follow-ons (migrated from the purse spec on promotion, resume-context intact)
> and the alert feed.

---

## Purse follow-ons (deferred by design)

Migrated from the purse spec at promotion. Each item carries its resume-context — do not reduce to
one-liners.

### Monetisation staging (the arc the purse slice started)

Each stage replaces a proxy with the real flow it stood in for; the itemised treasury structure
never changes.

- **Stage 2 — state spending becomes goods demand.** Construction consumes real materials bought
  at market prices (EU5 shape: goods drawn during construction, shortages pause builds). This is
  the damper that makes price-linked income safe. *Only then* add a spot-price-linked income line,
  kept a minority share next to the stable core (a minority share can't fund famine-states or make
  scarcity-engineering worthwhile, and the stable core damps the oscillator). Open design question
  from the spec's risk 4 (imputed revenue mismeasures trade): value output at something less local
  than home-system spot price.
- **Stage 3 — pop monetisation.** Buildings pay wages; pops buy consumption at market prices. The
  heads tax retires into an income tax on real wages; the production-at-reference tax into a
  profits/dividends tax; and a **consumption tax** (VAT on real transactions — bites poorest pops
  hardest, the sharpest revenue↔unrest instrument) becomes available as a genuinely distinct third
  line. "Which systems are rich" becomes fully emergent rather than assessed.

### Control (future system, not just a tax modifier)

Control is *the* space-native version of EU5's multiplier: real distances make control expensive in
a way map adjacency never is. First fiscal form: **unrest-attenuated collection** (high taxes →
unrest → lower collection — a self-damping stabiliser using existing machinery). Later:
capital/distance-based control, development as an input.

### Claim pricing (designed alongside control)

Claims (the cheap `unclaimed → controlled` border-staking step; develop already carries the
physical colonisation costs) should cost money — but the interesting price is control-shaped
(further from the core → dearer to claim and to keep), so it waits for the control design rather
than shipping as a flat fee. The per-pulse claim cap + reach bound prevent degenerate free grabbing
in the meantime.

### Neglect wear on staffed buildings

At 0% effective maintenance, v1 leaves fully-utilised buildings intact (the idle channel can't
touch them, and adding a third decay channel isn't worth its engine cost yet). If total neglect
should eventually crumble even working machines, that's a new, explicitly-owned decay channel —
design it then, don't imply it.

### Per-building-group maintenance sliders

If playtesting shows genuine want for triage ("protect industry upkeep, let housing slip"), split
the one maintenance band into a few grouped bands — purely additive on the itemised bill. Costs
are UI surface, AI policy per slider, and calibration axes — pay them only once the choice is
proven fun.

---

## Alert feed (faction situation log)

The faction's per-asset alert feed and situation log — the Paradox alert-strip model
(`grand-strategy-vision.md` calls this out as "Notifications / Captain's Log" in its systems-mapping
table). Comes once there is enough autonomic + player activity happening across a faction's territory
that surfacing "where to look" earns its own surface, rather than requiring the player to tour every
system.

---

## Sequencing

The alert feed is designed but not planned in implementation detail — it gets its own design pass
(spec → build plan) when picked up, following the same per-slice process the seat, control, and
purse slices used. The purse follow-ons above are staged behind their prerequisites (Stage 2 before
any price-linked income; control before claim pricing).
