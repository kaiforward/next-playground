# Events rework — working file

## Idea

### Problem

The event system is trader-era decoration. Its 14 randomly-spawned types apply flat economy
modifiers (production/consumption rate multipliers, price-anchor shifts, supply/demand shocks —
`lib/constants/events.ts`) that expire on a timer, tie into no shipped mechanic, and offer the
player nothing to do about them. It is also the tick's worst scaler — its share of a mid-cycle
tick went 19.4% → 67.5% as everything around it was optimised (tick-speed audit figures, carried
on the roadmap events row). The one part that works is the relations-owned trio
(`border_conflict`, `pact_under_negotiation`, `alliance_dissolved`): spawned at weight 0 by the
relations processor from faction-pair scores, never by dice (`lib/constants/relations.ts:161-171`).

### Chosen direction

Strip now, prep the machinery, add content only when a mechanic earns it.

1. **Strip the random-modifier spawners** — every event whose topic is a fake version of
   something the sim produces or the queue is about to build for real: `supply_shortage`,
   `mining_boom`, `ore_glut`, `trade_festival`, `inner_system_conflict`, `conflict_spillover`,
   `pirate_raid`, `trade_embargo`, `refugee_crisis`, `tech_breakthrough`, `plague_risk`.
2. **Keep a lean exogenous core** — `solar_storm`, `asteroid_strike`, `plague` — and re-point
   their effects from rate multipliers to physical consequences (destroy stock, damage
   buildings, kill pops) so outcomes propagate through real mechanics instead of expiring.
3. **The dice rule:** a small random roll is allowed, but frequency/severity must always carry a
   real modifier from world composition (asteroid events scale with a system's belt count) or
   player neglect (plague needs underfunded healthcare or a vulnerability to land), and
   mitigation must be buildable (orbital defenses, healthcare). RNG decides *when*; world state
   decides *how likely and how bad*; player investment decides *mitigation*.
4. **Entry bar for all future content:** an event cannot ship unless the mechanic that makes it
   preventable or exploitable is named and shipped.
5. **Generalise the relations pattern into arc plumbing** — any processor can open a weight-0,
   multi-phase arc with player-visible options. Strikes are the documented first client, written
   when a pressure mechanic ships (strike pressure is currently calm: 5.6% of colonies striking
   at full scale, a near-dead pop<10 cohort — roadmap strike-calm row).
6. **Decision popups** — center-screen choice moments, first clients the three relations arcs
   (they currently render in the same pill list as random plagues, so nothing reads as
   faction-related — `components/panels/faction-events.tsx`).
7. **Events never inject unrest or danger.** They create conditions (a shortage, a dead route,
   dead pops) and the unrest loop reacts.

### Killed alternatives

- **Fix processor performance standalone** — the model decision rewrites the processor anyway
  (was the roadmap perf row's own guidance).
- **Measure-first re-base of the coverage cap** — the cap dies with the model; owner call
  ("I just don't feel like we need a measure, the original events are from ages ago").
- **Keep the modifier events and retune them** — they are fake versions of mechanics the queue
  builds for real (shortages → markets, piracy → logistics, conflicts → war, refugees → pops).
- **Pure-dice natural events** — killed by the dice rule; even naturals get composition
  modifiers and buildable mitigation.
- **Build the strike arc now** — nothing applies pressure yet; a chain built today sits dormant
  (see the 5.6% figure above). Content waits; only the plumbing ships.

### Premises

**Definitional (owner decisions, this session, 2026-08-30):**
- "Make nearly all events preventable through good gameplay management … an event can't go in
  unless we add a mechanic that makes it interesting."
- "A tiny bit of dice rolling or very low chances [is fine], but then there should always be a
  real modifier that makes it meaningful like player neglect or world composition."
- "We can prep events, but … only add something that genuinely feels valuable right now to the
  existing mechanics."
- Relations arcs get expanded visibility, "maybe some of these events get center screen popups."

**Checkable (implementation gates, not direction inputs):**
- The stripped events are decoration, not load-bearing: the post-strip simulate stays on the
  health bar (no NaN/runaway/pinning, dispersion and liquidity intact) at both horizons.
- Saves in the wild hold active events of stripped types; the load path must handle them
  (verify by code read before the strip lands).
- The events processor's tick share drops materially post-strip (baseline: 67.5% of a mid-cycle
  tick; re-baseline in-run, percentages only).

**Hypothesis:**
- Belt count is already generated per system in a form asteroid frequency can read
  *(hypothesis — verify in `lib/world/gen.ts` at spec time)*.

### Terminal falsifier

If the post-strip `npm run simulate` at the 10,000-tick horizon shows a health-bar regression
attributable to event removal — dispersion collapse or price pinning that the pre-strip baseline
does not show — then the modifier events were load-bearing perturbation, and the strip cannot
ship without a replacement perturbation source. That kills "strip with no replacement", the
premise the whole sequencing stands on.

### Exit

No `/measure` stage: the direction replaces the system rather than resting on claims about its
current behaviour — the owner's explicit call, quoted above. Next stage is `/feature-spec` for
the strip + lean core + arc plumbing, drawing the hazard sweep from this file.

### Hazard-3 sweep (brainstorm depth)

| System | Interaction |
|---|---|
| Events | The change itself. |
| Population + migration | Plague re-pointed to kill pops physically; `refugee_crisis` deleted (migration is already mechanical one-hop diffusion). |
| Unrest / regime | Events stop being able to touch unrest directly (rule 7); removing supply shocks changes provision dips the strike loop reads. |
| Industry + staffing | Physical effects destroy stock/buildings; rate-multiplier removal changes production paths. Future mitigation buildings must be staffable. |
| Infrastructure decay | Mitigation infrastructure (defenses, healthcare) will decay like anything else — content-stage concern, none at strip stage. |
| Directed logistics | Supply-shock events deleted; events processor shares the per-tick `TickSystem` consumption with ship-arrivals (roadmap `toTickSystems` row). |
| Directed build / planner | None at strip stage — planner reads demand/supply, not event state. Mitigation buildings enter its ROI at content stage. |
| Colonisation + founding | None at strip stage; belt-count risk later makes system composition a colonisation consideration. |
| Treasury / purse | None at strip stage; "well-financed healthcare" implies a future budget category. |
| Factions + relations | Relations arcs kept, promoted to popups; relations processor untouched otherwise. |
| Save format (`World` shape) | Active events of deleted types exist in saves; `GameEvent`/phase shape changes with physical effects. Load path is a named gate. |
| Harness metrics | `lib/tick-harness/event-analysis.ts` and any event-count characterisation pins re-derive after the strip. |
