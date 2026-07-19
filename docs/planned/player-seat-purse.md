# The Purse — Design In Progress

> **⚠ Design in progress** — brainstorm working notes for player-seat Slice 3 (faction money), not yet
> a finished design. Supersedes-in-progress the purse section of
> [player-seat-roadmap.md](./player-seat-roadmap.md). When the design settles this becomes the planned
> spec; when the slice ships it moves to `docs/active/gameplay/`.

---

## Decided so far

1. **Money is fuel for the physical pools, not a replacement for them.** The construction pool
   (eligible heads + Construction Centres) and the logistics work-budget remain the *physical
   ceilings*. The treasury funds their **activation**: a fully funded band runs 100% of physical
   throughput; a starved band idles workers who exist but aren't paid. Money never buys past the
   physical ceiling (the `work ÷ absorbed` floor stands — wealth can't compress build time), it only
   buys up to it. This keeps eligible heads, Construction Centre backlog-frontier pricing, and
   emergent build duration intact. The roadmap's "budget bands replace the free pool" reads as
   *replace the free-ness*, not the physical model.
2. **EU5-style investment slider** for the funding level — a smooth 0–100% dial per band (EU5's
   expected-expenses categories are the model: each 1% funded yields proportional effect), not a
   binary on/off.
3. **Money will eventually have many uses** (EU5/Vicky-shaped: claim pricing, military, diplomacy…)
   — but this slice builds only the construction/logistics fuel use. Design the treasury as the
   general container; don't over-fit it to construction.

## Open questions (the mull list)

- **Tax base grounding** — the big one. Candidates, both computable from existing per-pulse data:
  1. **Grade-weighted employed heads** (Vic3 income-tax shape) — `computeLabourAllocation` already
     yields employed unskilled/technician/engineer heads per system; tax at grade weights
     (engineers "earn" more). Stable, smooth, no price coupling; derived from buildings +
     population only (the same no-circularity signal S3 demand uses). But a faction whose industry
     sells nothing still taxes fully.
  2. **Building output valued at market prices** (EU5 building-profits shape) — production × local
     spot price. Honestly emergent (money tracks what the economy actually makes), but wires price
     volatility into state income.
  3. **Hybrid** — wage-like head base as the stable core + an output-value term. "In reality both
     are taxed" (Kai). Current lean: hybrid, or start with (1) and layer (2) after observing it in
     the simulator.
  - Circularity check (from the Vic3 research): taxing output-at-prices is *not* inherently
    circular — it sits downstream of the market (prices → revenue → tax, one direction). The only
    return path is what the state *spends* on, which in Vic3 is real goods demand from
    construction — a legible, stabilising loop. Our worry is volatility more than circularity.
  - Note: Vic3 taxes **only pops** (buildings pay wages/dividends to pops; the state taxes pop
    income/spending/existence). It can do that because pop income is a modelled flow. We don't
    model wages — heads-by-grade is our wage proxy, output×price our revenue proxy.
- **EU5's control multiplier** — effective tax base = potential × control (capital proximity,
  integration, satisfaction). Do we want an analogue (e.g. unrest- or distance-attenuated
  collection), or is that a later layer?
- **Tax policy lever** — Vic3's 5-step level trading revenue against radicalism/legitimacy maps
  directly onto a tax term in our `unrest` integrator. Granularity (steps vs slider), per-faction
  only or per-system later, and how the AI sets it (government/doctrine-flavoured default?).
- **Maintenance sink** — roadmap names per-building maintenance (EU5's standing ~20% sink). Which
  buildings, flat-per-level or type-scaled, and what does *unpaid* maintenance do (accelerated
  idle-decay? nothing in v1?).
- **Deficit behaviour** — no-debt clamp at zero vs Vic3-style stall (unfunded bands idle) vs
  EU5-style loans/bankruptcy spiral. Instinct: v1 = clamp + stall, no debt instrument.
- **Budget bands scope** — construction only, or construction + logistics from day one? (Logistics
  currently has no player verb — a band without a lever behind it was the reason Slice 2 skipped
  the logistics automation switch.)
- **Claim pricing** — roadmap flags territorial claims (currently free) as a candidate money cost
  once a treasury exists. In-scope for this slice or booked as a follow-up?
- **AI parity** — all nine factions run the same treasury/budget mechanism (same-brain principle);
  what do AI budget allocations look like — fixed sensible defaults, or doctrine-driven?
- **Playerless harness** — treasury must run identically in the calibration harness (it's faction
  machinery, not player machinery — unlike automation switches). Needs harness health metrics
  (treasury solvency dispersion, funded-fraction distribution, no runaway hoards).
- **UI surfaces** — faction panel treasury card (balance, income/expense breakdown, band sliders,
  tax level); where the funded-fraction shows on the construction command card.

## Research synthesis (2026-07-19)

### Vic3 — construction funding

- Capacity is **physical**: construction-sector buildings turn goods + labour into weekly
  construction points that pace the queue. Base +10/week national, sectors add per level.
- Money is the **fuel**: government pays sector wages + input goods weekly; the goods bill scales
  with capacity actually used (wages paid regardless — idle capacity still costs something).
- Queue splits government (treasury) / private (investment pool) by economic-system law; the
  private queue **halts outright** when its pool is dry; either queue can borrow the other's spare
  points. Bankruptcy: −75% construction efficiency.

### Vic3 — income

- Two tax families: **poll taxes** (flat per-capita: land/per-capita/heathen) and **percentage
  taxes** (income tax on wages, consumption taxes on specific goods, dividend taxes on building
  profits distributed to owner pops).
- The **tax level** (very low → very high, 5 steps) trades revenue against politics: very high ≈
  +100% radicals from movements, −20% legitimacy, −20% government interest-group approval; very low
  reverses. This is the revenue↔unrest lever, ready-made.
- Collection is lossy: insufficient bureaucracy → national tax waste; state obstinance up to −10%.
  Pops pay the full nominal rate; the *state* absorbs the waste.

### EU5 — income

- Per-location **tax base** = RGO profits + building profits + burgher trade activity, ×
  **control** (capital proximity up to +75%, satisfaction, integration status, location rank).
- **Minting** converts 0–25% of tax base into gold; minting above a threshold (base 5%) accrues
  inflation (+0.005/1% excess monthly).
- Estate weighting splits the base (nobles 100 / burghers 40 / clergy 25 / peasants 1).
- **Expected expenses**: three optional categories each costing 10% of tax base, each 1% funded
  yielding a proportional drip benefit (court → legitimacy, stability investment, diplomacy) — the
  smooth 0–100% investment-dial pattern.

### EU5 — construction

- **Upfront gold cost** by unlock age (50 → 1,200), scaled by the local price of construction
  goods; goods are consumed *during* construction and missing goods **pause** it.
- Ongoing per-building **maintenance** (~20%-of-income scale at typical play) is the standing sink.
- Bankruptcy: debts cleared but −90% construction speed for 60 months, 10% of buildings downgraded.

### Sources

- https://vic3.paradoxwikis.com/Construction · https://vic3.paradoxwikis.com/Taxes ·
  https://vic3.paradoxwikis.com/Building
- https://eu5.paradoxwikis.com/Economy · https://eu5.paradoxwikis.com/Building
- https://www.pcgamesn.com/victoria-3/construction-buildings

## The emerging shape (one paragraph)

Physical pools stay the ceiling (Vic3); a per-band budget slider sets what fraction the treasury
funds (EU5's smooth dial); the treasury fills from a tax base grounded in real economic activity ×
a tax-level policy whose cost is unrest (both games); per-building maintenance is the standing sink
(EU5); deficit stalls activation rather than borrowing (v1). All nine factions run it; the harness
gets solvency metrics.
