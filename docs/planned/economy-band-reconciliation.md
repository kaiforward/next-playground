# Economy Band Reconciliation — Knee'd Curves, Regime Legibility, and the Pressure-Driven Population

> Design pass settled 2026-07-20 (supersedes the `[L]` BACKLOG brief). Not yet built. Landing this
> triggers an unrest/tax recalibration and a treasury recalibration (see §8). The wireframe work in
> §7 gets its own collaborative HTML pass at build time.

## Headline

The economy's throttle curves gain **knees**: consumption delivers in full above a comfort
threshold, production runs at full rate up to the days-of-supply anchor, and the decay signal reads
healthy capacity as fully used. The resting state of a healthy system becomes **pops fully fed,
factories running, price ≈ base** — instead of today's structural ~80%-of-anchor equilibrium where
every system is permanently rationed ~17%, every producer reads ~90% "worked", and prices lean 24%
high at perfect health. Population growth stops being fuelled by empty housing (which decay then
eats — the treadmill) and becomes satisfaction-driven with **overcrowding as a soft brake** that
feeds unrest pressure and migration push — full worlds push settlers outward, making land
exhaustion the engine of colonisation. The market floor becomes a pure **price saturation point**
(draws may continue toward empty); the build planner sizes capacity to demand **plus a margin** and
gains a feedback backstop plus rate-limiting so the burst-build/decay see-saw disappears. The three
resulting regimes — **Comfortable / Squeezed / Shortage** (+ **Glut** on the producer side) — share
one set of threshold constants between mechanics and UI, so the panels name states instead of
showing contradictory percentages.

## Why (diagnosis, verified on code + a live save)

One structural fact wore many costumes. Production throttled by `√` over `[minStock, 1.3×T]` and
consumption by `√` over `[minStock, T]` cross at ~80–84% of the anchor `T`, so at perfect health:

- pops rationed ~17% (satisfaction ≈ 0.83) → permanent "pops short" badges and a structural unrest
  floor → a standing population-decline term;
- the selling/decay signal (`outputUptake`, measured on the full storage band) read ~0.85–0.9 →
  every producer stack ≥ ~7 levels and every margin-ahead housing stack held a permanent whole idle
  level → decay shed a level every buffer period → the autonomic rebuilt it (the treadmill; manual
  players with automation off just lost the ratchet);
- full satisfaction (stock ≥ T) required ~1.6× capacity overprovision, at which point uptake ≤
  ~0.82 put every stack ≥ 6 into decay — **full satisfaction and decay-safe industry were
  mathematically incompatible**;
- the planner's structural-deficit test compared full-staffed *capacity* to demand, while realized
  output was throttled ~21% below capacity — "capacity covers demand" blocked building forever
  while pops rationed; when a good's galaxy-wide spare vanished, `coveredFraction` flipped every
  deficit structural in one pulse (observed 60-level burst builds), which glutted, idled, decayed,
  and repeated.

The gentle everywhere-active `√` ramps were a deliberate trading-game design: the permanent
sub-anchor equilibrium *was the arbitrage spread* the player-trader lived on. That player no longer
exists; the spread is pure loss. Paradox economies (Vic3/EU5/Stellaris, researched 2026-07-20) use
the opposite grammar — flat healthy region, discrete named problem regimes with thresholds,
escalating maluses, and hysteresis — and that grammar is what this design adopts.

## 1. Curve geometry — the three knees

Vocabulary (unchanged): anchor `T = TARGET_COVER × demandRate × anchorMult` (price = base), hold
ceiling `1.3×T` (HOLD_COVER), storage max ≈ `2×T + storage`, price-saturation point `0.5×T`
(ex-`minStock`).

- **Consumption comfort knee**: full delivery while `stock ≥ COMFORT_COVER × T` (initial 0.75).
  Below it, satisfaction ramps convexly (√-shaped: gentle just under the knee, brutal near empty)
  to 0 at **stock = 0** — not at the floor (§4). Healthy systems have satisfaction exactly 1 and
  contribute zero structural dissatisfaction.
- **Production knee at the anchor**: full rate while `stock ≤ T`; ramps to 0 across `[T, 1.3×T]`.
  The anchor is the producer's normal hold; `[T, 1.3×T]` becomes a deceleration zone absorbing
  shocks. A self-supplier with margin capacity rests just above `T` → **healthy price ≈ base**
  (decision: knee *at* the anchor, so price is a true health gauge with full two-sided dispersion
  range; the rejected alternative — knee above the anchor — made "healthy" read ~0.8× everywhere
  and compressed the glut-signalling range).
- **Selling/decay signal**: producers' `used = staffed × min(1, throttleFactor + USED_SLACK)`
  (initial slack 0.15), replacing the storage-band position read. Healthy producers read fully
  used; genuinely glutted or demand-dead producers (throttle → 0) read idle and decay prunes them
  to fit. A single deliberately-overshot level on a small colony stays decay-safe via the existing
  whole-level floor.
- **Regimes fall out of the same constants**: Comfortable (`stock ≥ comfort`), Squeezed (below
  comfort: rationing active, price climbing), Shortage (satisfaction < 0.5 — the existing critical
  severity threshold, reused so the boundary is already shipped), plus Glut as the producer-side
  exception, defined by the §1 decay signal itself (`used < count`, i.e. the throttle+slack read
  says output is idling). §6 makes the UI speak them.

Knock-on recorded: with structural dissatisfaction = 0 at health, **the only standing unrest floor
is tax** (purse Plan 2's `taxPressure`), so population equilibria rise galaxy-wide → §8
recalibration.

## 2. The build planner — measuring need, pacing the response

- **Provisioning margin**: capacity targets `(1 + PROVISION_MARGIN) × demand` (initial 0.10–0.15).
  Exact-capacity builds park a system on the comfort boundary with no recovery rate; the margin is
  the shock absorber.
- **Feedback backstop**: a system **squeezed for ≥ 2 consecutive pulses** counts its rationed gap
  as structural deficit regardless of nominal capacity coverage — catches input-gated chains, yield
  drift, and event damage the capacity test cannot see.
- **Response pacing** (kills the burst-build): a residual must persist 2 consecutive pulses before
  it is proposable, and each pulse proposes at most `BUILD_RATE_CAP` (~⅓–½, calibrated) of a good's
  outstanding gap — the correction ramps over 2–3 months. Distance-weighting the spare pool is a
  noted possible refinement, deliberately not in this pass.
- **Logistics under the new geometry**: the matcher already converges receivers on the anchor,
  above the comfort knee — imports arrive before rationing starts. New constant dependency asserted
  in tests: `DEFICIT_FRACTION > COMFORT_COVER`. **Decision**: structural exporters
  (production > local demand) may be drawn down to *comfort* (not just the anchor) — pops
  unaffected, the exporter spends more of the month at full throttle, and the comfort→anchor band
  becomes export working capital. Non-producing stock-holders keep the anchor floor.

## 3. Population growth and housing — fuel tank → pressure valve

- **Growth**: `rate × pop × (1 − D) × crowd(r)` where `r = pop ÷ popCap`. `crowd(r)` = 1 while
  `r ≤ 1.0`, braking smoothly to 0 at `r = CROWD_BRAKE_END` (initial 1.15). Population may exceed
  popCap freely; the logistic headroom term is gone. Decline channels unchanged (unrest-scaled
  decline; overshoot-death for the housing-rotted collapse).
- **Overcrowding pressure** (`1.0 < r`): a **bounded** unrest contribution (clamped like tax
  pressure — a full world can never strike-spiral off crowding alone) plus migration push via the
  existing overshoot-repel coupling. Full systems slow, grumble, and export people — **land
  exhaustion drives colonisation**.
- **Housing decay vacancy allowance**: `used = min(count, occupancy × (1 + VACANCY_SLACK))`
  (initial 0.10). Normal vacancy reads fully used at any stack size — the treadmill becomes
  structurally impossible — while genuine emptying (pop collapse, mass emigration) still decays.
- **Autonomic housing flips to pressure relief**: build when `r` rises past ~0.95, sized to return
  `r` to ~0.92 — strictly inside the vacancy allowance (8% vacancy < 10% slack), so autonomic
  housing never feeds decay at any stack size. The
  fed-and-calm gate stays. `SETTLE_MARGIN`'s pre-provisioning identity is retired.
- **popCap identity**: no longer a growth asymptote — it is the comfort line where crowding
  pressure begins. Still derived from housing exactly as today. Housing remains purely structural
  (no rent, no housing-quality goods this pass).

## 4. The floor — pricing construct, not a goods wall

- `minStock` keeps one job: where the price curve saturates at the ceiling. The tick's stock clamp
  becomes `[0, maxStock]`; consumption and recipe draws run toward empty. The UI never draws it as
  an untouchable reserve; vocabulary: **price saturation point**.
- **Decision — shared scarcity ramp**: below comfort, civilian consumption and industrial input
  draws ration on the same curve proportional to demand share. No ordering rule; civilian pain
  already dominates unrest via the convex dissatisfaction fold; industry pain cascades legibly
  through input-gated output. (Rejected: civilian-priority draws — extra machinery, and
  self-defeating when pops eat a food plant's biomass input.)
- **Crisis becomes real and only real**: true empty (satisfaction 0, unrest climbing into
  strike/collapse) is reachable only in genuine catastrophe, never as a market's resting state.
- **Designed later promotion** (not built now): with purse Stage 2–3 monetisation, a *legible*
  EU5-style reserve — a visible, policy-set stockpile (N days held back, crisis release /
  requisition, war stores) rationed by access.

## 5. Infrastructure decay — gardener, not treadmill

- **Idle buffer 6 → 12 reference-months.** Idle now means genuinely unneeded, so the buffer's only
  jobs are how long over-capacity lingers and how long a dead colony's infrastructure survives.
- **Big-stack bias is cured by honest signals, not new machinery** — the whole-level trigger,
  one-level-per-buffer pacing, unrest-collapse channel (θ = 0.75), academy/complex utilisation
  reads, and single-level overshoot protection all stay exactly as built.
- **Couplings recorded**: maintenance funding's `bufferScale` (purse Plan 2) now governs
  glut-pruning speed and dead-colony persistence rather than a background treadmill — re-checked in
  §8. Stored idle-month counters survive saves harmlessly (healthy systems zero them on the first
  post-change run).

## 6. Presentation contract — the panels speak regimes

Content contract only; concrete layout gets the house collaborative wireframe pass at build time.

- **Per-good regime chip** (Comfortable / Squeezed / Shortage / Glut) everywhere a good appears,
  driven by the §1 constants — the UI cannot contradict the simulation.
- **Days of cover is the primary unit** (stock ÷ demand rate, against anchor 40 / comfort 30); raw
  units demote to tooltips.
- **The Industry roster's "Worked" column splits**: a *Staffed* figure (pure labour, per grade) and
  a *state chip* naming the condition (producing / glut-idling / input-short on *which* input /
  understaffed on *which* grade). The single number that blended staffing with selling is retired.
- **Needs panel**: "pops short X%" appears only below comfort — after §1 that is always a real
  problem, never ambient noise. Severity thresholds ride the regime constants.
- **Alert feed** (Slice 4, later): regime transitions (entering Shortage, going overcrowded) are
  its natural events — pointer recorded.

## 7. New/changed constants (all coarse first-cuts, harness-calibrated)

| Constant | Initial | Meaning |
| --- | --- | --- |
| `COMFORT_COVER` | 0.75 | Comfort knee as a fraction of the anchor |
| production knee | 1.0 × T | Full rate to the anchor; ramp ends at HOLD_COVER (1.3, unchanged) |
| `USED_SLACK` | 0.15 | Producer decay-signal slack on the throttle |
| `VACANCY_SLACK` | 0.10 | Housing decay-signal vacancy allowance |
| `CROWD_BRAKE_END` | 1.15 | Occupancy ratio where growth reaches zero |
| crowding-pressure clamp | 0.05 | Max unrest-integrator contribution from overcrowding |
| `PROVISION_MARGIN` | 0.10–0.15 | Planner capacity margin over demand |
| squeeze persistence | 2 pulses | Feedback-backstop + proposal persistence window |
| `BUILD_RATE_CAP` | ~0.4 | Max fraction of a good's gap proposed per pulse |
| `idleBufferMonths` | 12 (was 6) | Sustained-idle buffer |
| housing pressure trigger / target | 0.95 / 0.92 | Autonomic housing relief band (target inside the vacancy slack) |

Constant dependency asserted in tests: `DEFICIT_FRACTION > COMFORT_COVER`.

## 8. Interactions, recalibration, validation

- **Unrest/tax recalibration**: structural dissatisfaction vanishes at health, so tax becomes the
  only standing unrest floor — population equilibria rise; re-check tax-level pressure and strike
  thresholds against the harness.
- **Treasury recalibration** (Task-10-style, flagged when this pass was sequenced): realized output
  rises galaxy-wide → production-tax income moves; re-run the purse funding-gate calibration.
- **Invariance**: `ECONOMY_SCALE` ratio-invariance holds by construction (all knees are
  band-relative); re-run the invariance bridges. S=1 output is *not* byte-identical to pre-change —
  update fixtures; keep magnitude assertions range-y per the coarse-health standard.
- **Harness validation targets**: no "pops short" badges at rest on healthy systems; median
  price/base ≈ 1.0 with real dispersion both directions; housing stacks stable without rebuild
  churn; no burst builds (new sim metric: max levels committed per good per pulse); dead colonies
  still cleaned up; genuinely glutted capacity prunes; colonies populate; no NaN/runaway/pinning.
- **Regime-share metric**: add % of (system, good) pairs per regime to the simulate report — the
  permanent instrument for this pass and future economy work.

## Out of scope

The reserve/stockpile mechanic build (§4 pointer), rent or housing-quality goods,
distance-weighted spare netting, per-building labour assignment (uniform proportional staffing
stays), and any map price-mode work.

## Housekeeping folded into the build

`lib/tick/processors/economy.ts:168` cites `docs/planned/economy-equilibrium-rework.md`; the doc
lives at `docs/active/gameplay/economy-equilibrium-rework.md` (never deleted — the BACKLOG brief's
recovery instruction was unnecessary). Fix the pointer; on ship, update that active doc (its
"change" section describes the geometry this pass replaces), delete the `[L]` BACKLOG item, and
re-audit the hedged maturity-flattens-spread memory note against the new equilibrium.
