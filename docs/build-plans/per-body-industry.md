# Per-body industry via derived fill-order occupancy

## Idea

**Problem.** The game generates real per-body substrate — each `WorldBody` carries its own deposit
counts, quality bands and people-land (`lib/world/types.ts:281-305`) — but industry throws the
per-body dimension away: buildings are `(systemId, buildingType, count)` with no body key
(`lib/world/types.ts:309-317`), and extraction yield is one per-system number per resource, the
deposit-count-weighted mean of every unlocked body's `extractionModifier`, fixed at generation
(`lib/engine/body-gen.ts:190-198`, read at `lib/engine/industry.ts:473`). So the Astrography panel
tells a per-body story the simulation doesn't run, nothing can answer "what is on this body", and
the future tech-unlock row inherits a dilution hazard: unlocking a poor body re-averages the pool
and cuts every existing extractor's output overnight.

**Chosen direction (Kai, 2026-08-24): derived fill-order occupancy — the habitability pattern
applied to extraction.** The system stays the simulation unit permanently; bodies never become
processed units. No building gets a body key. Per resource, a system's built extractor levels are
deemed to work its bodies' deposits in a fixed deterministic order; effective yield becomes the
count-weighted mean over the *worked prefix* rather than over all unlocked bodies, recomputed only
when the worked count crosses a body boundary or a body locks/unlocks — the same cache shape
`systemHabitabilityQuality` already ships for land (occupied-prefix mean, recompute at body
boundaries). Consequences:

- "Where does industry sit" is derived, not stored — exact per-body answers with zero new
  per-building state and no save-format change to `WorldBuilding`.
- Unlocks become pure upside at the moment they happen: existing levels keep working the same
  prefix (yield unchanged), capacity rises, and the blended yield moves only when someone actually
  builds onto the poorer body — which the planner then prices at that body's own modifier instead
  of the system average. Dissolves the tech-unlock dilution hazard named on the
  growth-gated-behind-technology roadmap row.
- Body-conditional buildings generalise the same mechanism: a body authors slots of some type, a
  building bills the system aggregate of those slots, yield derives from the hosting bodies —
  deposits are just the first instance.

**Killed alternatives:**

- *Keep the pooled model, freeze per-extractor efficiency at build time when unlocks land* — leaves
  the per-body story cosmetic forever, keeps the planner scoring the average, and adds hidden
  per-building state later.
- *True per-body placement (buildings keyed by body)* — save-format break touching decay, planner,
  every industry readout and adapter, and nothing above it (labour, markets, logistics) is
  per-body. Decisive: mean bodies per system is ≈5 (`lib/constants/bodies.ts:204-233`, sun-class
  bodyCount ranges weighted by class weight), and tick cost scales with total processed unit count
  (ROADMAP, aspiration-scale row: 5 TPS wall crosses ≈19-20K systems), so per-body simulation moves
  the wall to ≈4K systems — the Stellaris trade (per-planet detail, ~1K-system cap), rejected for a
  Vicky3-scale one-map game. Kai also explicitly wants no separate playable system view.

**What this direction rules out, accepted:** per-body state that *diverges* from the derived order —
a body with its own unrest, market, or pop growth, or hand-placement of a specific building on a
specific body when the fill order says otherwise. Kai declined Stellaris-style placement
(2026-08-24).

**Free-floating buildings:** factories, academies, complexes and construction centres bill no
physical budget and so sit at the system, on no body. If a future mechanic (partial capture) needs
them located, a derived convention (e.g. "non-anchored industry sits on the most-populated body")
suffices — no stored state. *(hypothesis — untested until war design exists)*

## Premises

**Checkable — /measure claims:**

1. **Extraction yield is generation-frozen in practice:** every developed system's `extractionEff`
   vector is byte-identical at t=0 and t=10,000 — no tick path rewrites it. (Receipt says so at
   `lib/engine/body-gen.ts:124-134` doc + grep; the measurement confirms no unlisted writer.)
2. **The prefix–pool difference is material:** at both horizons, a non-negligible share of
   developed (system, resource) pairs with built extractors would read a different yield under
   worked-prefix mean vs all-bodies pool — i.e. systems exist where built levels < total deposit
   counts AND the hosting bodies differ in `extractionModifier`. Report share of pairs and the
   magnitude distribution, cohorted (homeworlds vs colonies).
3. **Extractor levels never exceed deposit counts** (the prefix mapping is total): zero
   (system, resource) pairs at either horizon with extractor count > aggregate deposit count.
4. **Downward recompute would actually fire:** decay sheds extractor levels in practice at
   equilibrium (count of shed extractor levels > 0 at 10K), so the prefix boundary must recompute
   on count decreases, not just growth.

**Definitional (owner decisions):**

- The system is the simulation unit permanently; bodies are real substrate acted on through the
  aggregate rebuild path. — Kai, 2026-08-24: "moving it all to an aggregate might make the most
  sense" / "im on board with how B solves it".
- One map, no separate playable system view. — Kai, 2026-08-24: "I want to avoid having a separate
  system view like stellaris".
- **Open at spec time:** the fill order itself. Recommended default: best `extractionModifier`
  first, mirroring fill-best-first land. Alternatives (quality-band-weighted, richest-body-first)
  to be decided at /feature-spec, not measured.

**Hypotheses (carried forward, labelled):**

- Staged system-level battles play out over the occupied prefix — each habitable/occupied body a
  battle stage, best world the last stand; the fill order supplies the stages and their order with
  no per-body population. **Book to `docs/planned/grand-strategy-vision.md`'s war section when this
  file is deleted** — recorded here at Kai's request (2026-08-24), input to the future war
  brainstorm, not a claim this feature builds anything toward.
- Non-anchored buildings can stay system-level indefinitely (above).

## Bundled follow-on: visual system view

Kai (2026-08-24): a simple 2D/3D visual system view inside the system detail panel — bodies as a
spatial layout with popovers, alongside (not replacing) the body cards. Built as a follow-on to the
mechanical change, on the same branch/feature. UI-heavy, so it gets the browser-viewable HTML
prototype pass approved before implementation (AGENTS.md, UI/dataviz). Not part of the mechanical
premises above; it consumes the same derived per-body reads (worked deposits, occupancy) the
mechanical change creates.

## Measurement plan — per-claim falsifiers (committed before the instrument runs)

Instrument: one scratch script (`temp/body-prefix-diag.ts`, gitignored) driving the real
`runWorldTick` on `generateWorld({ systemCount: 600, seed: 42 })` — the same cohort the
industry-land measurement used — snapshotting at t=0 / t=1,000 / t=10,000 and accumulating
per-cycle extractor-count decreases across the run.

1. **Eff is generation-frozen:** falsified if any developed system's `extractionEff` vector
   differs between t=0 and t=10,000. If falsified, the "fixed pool" framing is wrong and the
   dilution hazard needs re-derivation before any design.
2. **Prefix–pool difference is material:** the terminal falsifier below (share <~2% AND median
   magnitude <~2% at 10K, re-read at 1K) kills shipping the mechanical switch now.
3. **Prefix mapping is total:** falsified if any developed (system, resource) pair reads
   extractor count > aggregate deposit count at either horizon — the model would need an
   overflow rule before spec.
4. **Downward recompute fires in practice:** falsified if zero tier-0 extractor levels are shed
   across the whole 10,000-tick run. If falsified, the decrease trigger still gets built (decay
   is shipped behaviour) but is proven by fixture, not sim.

Validation of the instrument: claim 3's cap check doubles as it — `computeBuildOptions` enforces
the same inequality independently (`lib/engine/build-options.ts:88`), so a violation reads as
"instrument miscounts extractors" before "game breaks its own cap". The body-side deposit sum is
cross-checked against the system aggregate (`depositCountsOf(system)` must equal the per-body
sum over unlocked bodies) — two independently-written paths (`lib/world/gen.ts:141` columns vs
`world.bodies` rows) that must agree.

## Evidence

```
Meaning:    Extraction is massively under-built against deposits everywhere, so the pooled yield
            model and the worked-prefix model disagree on most worked resources — and the prefix
            reads HIGHER, because built extractors would be credited the best bodies instead of
            the all-bodies average. The pool is confirmed generation-frozen, the extractor cap
            holds, and decay decreases are real but rare.
Claim:      (2, terminal) A non-negligible share of developed (system, resource) pairs with built
            extractors read a different yield under worked-prefix vs pooled mean.
Number:     76.9% of pairs differ at 10K (392/510; median +10.69%, p90 +26.38%, max +50.56%);
            91.4% at 1K (128/140; median +12.54%). 100% of pairs are partially worked at both
            horizons. Claim 1: 0/600 systems' extractionEff drifted from generation at either
            horizon. Claim 3: 0 cap violations. Claim 4: 2 tier-0 extractor levels shed over 10K.
Horizon:    both — t=1,000 (pre-founding: 20 developed = homeworlds only) and t=10,000
            (founding era: 164 developed).
Cohort:     developed systems, split seeded-homeworld vs colony (homeworld 91.4% differing at
            both horizons; colony 71.4% at 10K). Seed 42, 600 systems, real runWorldTick.
Licenses:   Ships the mechanical switch — the terminal falsifier (<2% share AND <2% magnitude)
            is decisively cleared, on the colony cohort too, so this is not a homeworld artifact.
            Also licenses: the prefix map is total (cap holds), and recompute-on-unlock needs no
            tick-time writer today (eff frozen). It does NOT license: any equilibrium claim
            (t=10K is founding era ~year 7); treating the +10-13% median yield rise as free —
            switching models is a broad tier-0 OUTPUT BUFF whose galaxy effect must be read at
            the feature's own simulate gate; or relying on the sim to exercise downward recompute
            (2 shed events in 10K ticks — the decrease path gets a fixture test, not sim proof).
Falsifier
outcome:    CONFIRMED, all four claims. Instrument validated: per-body deposit sums matched the
            system columns 0-mismatch, and the recomputed pool matched stored effOf() 0-mismatch,
            at both horizons.
```

Raw output (temp/body-prefix-diag.ts, verbatim):

```
=== t=1000 (seed 42, 600 systems) ===
developed systems: 20  (homeworld cohort: seeded-developed at t=0)
instrument validation: bodySum-vs-column mismatches=0  pool-vs-storedEff mismatches=0
claim 3: extractor-count > deposit-count violations = 0
(system,resource) pairs with built extractors: 140
  partially worked (n < deposits): 140 (100.0%)
  hosting bodies with >1 distinct modifier: 128 (91.4%)
claim 2: pairs where prefix != pool: 128 (91.4%)
  [homeworld] pairs=140 differing=128 (91.4%)
  [colony] pairs=0 differing=0 (n/a%)
  relDiff among differing: median=12.54%  p90=22.64%  max=33.63%
    system-438 water: built=19/152 over 5 bodies  pool=0.748 prefix=1.000 (+33.6%)
    system-177 radioactive: built=7/33 over 6 bodies  pool=0.767 prefix=1.000 (+30.4%)
    system-235 water: built=18/120 over 4 bodies  pool=0.777 prefix=1.000 (+28.8%)
    system-598 water: built=21/90 over 3 bodies  pool=0.778 prefix=1.000 (+28.5%)
    system-104 radioactive: built=8/21 over 4 bodies  pool=0.781 prefix=1.000 (+28.0%)
claim 4 (cumulative to t=1000): tier-0 extractor levels shed=0 across 0 (tick,system,type) decreases
claim 1 (t=1000): systems whose extractionEff differs from generation = 0 of 600

=== t=10000 (seed 42, 600 systems) ===
developed systems: 164  (homeworld cohort: seeded-developed at t=0)
instrument validation: bodySum-vs-column mismatches=0  pool-vs-storedEff mismatches=0
claim 3: extractor-count > deposit-count violations = 0
(system,resource) pairs with built extractors: 510
  partially worked (n < deposits): 510 (100.0%)
  hosting bodies with >1 distinct modifier: 392 (76.9%)
claim 2: pairs where prefix != pool: 392 (76.9%)
  [homeworld] pairs=140 differing=128 (91.4%)
  [colony] pairs=370 differing=264 (71.4%)
  relDiff among differing: median=10.69%  p90=26.38%  max=50.56%
    system-587 water: built=1/81 over 3 bodies  pool=0.664 prefix=1.000 (+50.6%)
    system-373 ore: built=1/21 over 5 bodies  pool=0.676 prefix=1.000 (+47.9%)
    system-495 water: built=1/137 over 4 bodies  pool=0.682 prefix=1.000 (+46.7%)
    system-124 ore: built=1/24 over 5 bodies  pool=0.687 prefix=1.000 (+45.5%)
    system-621 water: built=1/56 over 2 bodies  pool=0.693 prefix=1.000 (+44.3%)
claim 4 (cumulative to t=10000): tier-0 extractor levels shed=2 across 2 (tick,system,type) decreases
claim 1 (t=10000): systems whose extractionEff differs from generation = 0 of 600
```

### Re-measure at spec review (2026-08-25) — both vectors and the realised product

The original run folded the extraction modifier only; the spec review (finding 3) required the
quality vector and the realised product measured too. Same instrument extended (slots ordered by
ground value `qual × mod`; "today" = the pooled product `effPool × qualPool` the read site
multiplies; "prefix" = worked-prefix mean of per-slot products, the amended spec's definition).
This reading **supersedes** the original eff-only magnitudes wherever the spec quotes a buff size.

```
Meaning:    The full switch is roughly three times the size the eff-only reading suggested, and
            the quality half is the bigger contributor; a tiny negative tail exists because
            today's product-of-pooled-means can overshoot the honest per-slot mean.
Claim:      The realised worked-prefix multiplier differs materially from today's pooled product.
Number:     81.8% of pairs differ at 10K (417/510; signed median +29.36%, p90 +67.79%, max
            +184.42%, min −2.63%, 3 negative); 92.9% at 1K (median +29.82%). Split: eff-only
            median +4.94%, qual-only median +24.43% (10K). Validation: eff and qual pools both
            matched stored columns 0-mismatch.
Horizon:    both — t=1,000 and t=10,000.
Cohort:     developed systems, homeworld (92.9% differing) vs colony (77.6%). Seed 42, 600
            systems, real runWorldTick.
Licenses:   Confirms the terminal falsifier clearance a fortiori and sizes the buff the simulate
            gate must read against a pre-change baseline. Does NOT license: equilibrium claims
            (10K is founding era), or treating the small negative tail as a player-facing nerf
            path (3 pairs, ≤2.6%, an artifact of today's overshooting approximation).
```

```
=== t=1000 (seed 42, 600 systems) ===
instrument validation: bodySum-vs-column=0  effPool-vs-stored=0  qualPool-vs-stored=0
(system,resource) pairs with built extractors: 140
realised: pairs differing: 130 (92.9%); negative: 1
  realised relDiff: median=29.82%  p90=51.34%  max=84.62%  min=-1.91%
  eff-only: median=9.37%  p90=21.95%  max=33.63%  min=-20.36%
  qual-only: median=17.94%  p90=42.77%  max=58.90%  min=-12.96%

=== t=10000 (seed 42, 600 systems) ===
instrument validation: bodySum-vs-column=0  effPool-vs-stored=0  qualPool-vs-stored=0
(system,resource) pairs with built extractors: 510
realised: pairs differing: 417 (81.8%); negative: 3
  [homeworld] pairs=140 differing=130 (92.9%)   [colony] pairs=370 differing=287 (77.6%)
  realised relDiff: median=29.36%  p90=67.79%  max=184.42%  min=-2.63%
  eff-only: median=4.94%  p90=20.90%  max=47.89%  min=-22.77%
  qual-only: median=24.43%  p90=61.89%  max=192.85%  min=-16.65%
    system-210 arable: built=2/59 over 5 bodies  today=0.592 prefix=1.684 (184.4%)
    system-619 ore: built=1/21 over 5 bodies  today=0.710 prefix=1.767 (148.8%)
```

## Spec

**What changes:** A system's raw-resource extraction stops being penalised for deposits nobody
works. Built extractors are treated as working the system's best ground first, and their yield is
computed from only the deposits they actually work — so most systems' raw output rises, a system
with one good mining world and several poor ones reads like a colony on the good world, and a body
becoming available through future technology can only ever add capacity, never cut existing
production. Nothing new is simulated per body: the per-body story is derived on demand from what
is already stored.

**Why:** The generation model authors real per-body substrate but industry averages it away — the
pooled yield penalises built extractors ~10% median for unworked ground on 77% of worked resources
(Evidence), the per-body story in Astrography is cosmetic, and the future technology row inherits
a dilution hazard (unlocking a poor body would cut every existing extractor's output). Owner
decisions encoded, quoted:

- The aggregate stays the simulation unit: "moving it all to an aggregate might make the most
  sense" / "im on board with how B solves it" (Kai, 2026-08-24).
- Bodies stay mechanically real, cheaply: "No I do want them included, I just want the game to
  perform well" (Kai, 2026-08-24).
- One map, no separate playable system view: "I want to avoid having a separate system view like
  stellaris" (Kai, 2026-08-24).
- Proportional worked-slot fold confirmed: "are we then applying the yield buff/debuff
  proportionally according the the number of whatever deposit is on it" — yes; "Right I think I
  understand now" (Kai, 2026-08-24).

**Evidence** (full frame in `## Evidence` above):

- Realised worked-prefix multiplier differs from today's pooled product on 81.8% of worked
  (system, resource) pairs at 10K (92.9% at 1K; colony cohort 77.6%), **median +29.4%, p90
  +67.8%, max +184%**; the quality half contributes more than the modifier half (median +24.4%
  vs +4.9%); 3 of 417 differing pairs read slightly negative (min −2.6%). Both-vector re-measure
  at the spec review (2026-08-25), superseding the original eff-only reading. *Licenses:* ships
  the mechanical switch; does NOT license treating the switch as tuning-neutral (it is a large
  tier-0 output buff, first read against a pre-change baseline at the feature's simulate gate)
  nor any equilibrium claim (10K is founding era).
- `extractionEff` is generation-frozen, 0/600 systems drifted at either horizon. *Licenses:* no
  hidden tick-time writer to reconcile with; the writer change is confined to generation +
  count/lock events.
- 0 extractor-over-deposit violations at both horizons. *Licenses:* the worked-prefix map is
  total today; the overrun clamp below is defensive, not load-bearing.
- 2 tier-0 extractor levels shed in 10K ticks. *Licenses:* the downward recompute is real but
  sim-rare — it is proven by fixture test, never by a sim read.

**Not claimed:** No unlock mechanic ships (`[PENDING: technology]` stands; locks still only ever
release). The build planner remains yield-blind — tier-0 opportunity scoring does not read
`extractionEff` or `yields` today (no reference in `lib/engine/directed-build.ts`), and this spec
does not add one; scoring the marginal slot is a named possible follow-up, not shipped behaviour.
No per-body population, markets, unrest or any per-tick per-body state. The bundled visual system
view is a separate follow-on with its own prototype gate. The economy-type label stays derived
from all-bodies potential, not worked ground (deliberate — identity from endowment), **by
mechanism, not assertion**: `substrateAggregates` keeps returning the pooled potential vectors
(renamed `potential*`), which remain the inputs to `deriveEconomyTypeLabel` at
`lib/engine/universe-gen.ts:351` and `:631`; the worked-prefix fold is a separate derivation
applied to the `WorldSystem` columns only, and on the homeworld-prefab path it runs **after**
`s.buildings` is stamped (`universe-gen.ts:628` — today's assignment order at `:625` would fold
against no extractors). `economy-type.ts:3`'s "display-only" docstring is corrected as part of
this change — event targeting reads the label (see the Events row). Habitable-land/growth
quality is untouched (already
worked-prefix-based, `lib/engine/habitability.ts:61`). No constant is retuned to offset the
output buff; calibration stays at the coarse health bar per AGENTS.md.

### Behaviour

**Definitions.** A **slot** is one authored deposit of resource `r` on one unlocked body; a body
with `countOre = 3` contributes three ore slots, each carrying that body's quality multiplier
(`qualOre`, `lib/world/types.ts:297-304`) and its archetype's `extractionModifier`
(`lib/constants/bodies.ts:37-38`). A slot's **ground value** is the product
`qual × extractionModifier` — one number per slot, the yield an extractor working that deposit
realises. The **slot order** for `(system, r)` sorts slots by ground value descending, tie-broken
by the body's position in `world.bodies` (generation order — stable, save-deterministic). The
**worked prefix** is the first `n` slots of that order, where `n` is the system's built extractor
level count for the **resource** `r` — summed across every tier-0 good that draws on it, the same
shared figure the build cap uses (`extractorsOnResource`, `lib/engine/directed-build.ts:516-524`).

**The realised multiplier is the worked-prefix mean of ground values — exact, not approximate.**
Today the read site multiplies two all-unlocked-bodies pools written once at generation:
`extractionEff` (deposit-count-weighted mean modifier, `lib/engine/body-gen.ts:190-198`) and
`yieldMult` (deposit-grade vector, `lib/engine/body-gen.ts:173`), as
`rate × yieldMult[r] × extractionEff[r] × familyAnchorBuff` (`lib/engine/industry.ts:472-474`).
Under this spec the realised tier-0 multiplier for `r` is defined as **the mean of ground values
over the worked prefix** — the physically honest figure, since each worked deposit contributes
its own quality on its own body. Storage keeps the read site and the two columns' authored
meanings intact by decomposing: the `eff` column holds the worked-prefix mean of
`extractionModifier` (its authored meaning, "kept as its own aggregate",
`lib/constants/bodies.ts:37`, preserved for the UI), and the `yield` column holds
`meanOfGroundValues ÷ meanOfModifiers`, so the read-site product equals the mean of ground
values **exactly** — no cross-term, no approximation. **Caveat every reader must respect: the
`eff` column alone is NOT monotone under unlock** — only the realised product is (below); no
mechanic may treat the modifier column as an unlock-stable quantity.

**Recompute triggers, the write path, and the staleness invariant.** The fold recomputes for a
`(system, r)` whenever its extractor level count changes (a landed build level, a decay shed) or
the unlocked-class set changes, applied at the mutation site — no tick ever reads a column
inconsistent with current counts. The change must open three seams, because today none exists:
(1) the fold's per-body inputs (`bodyType` + `count*`/`qual*`) are read from `world.bodies` **at
the mutation site** — build-landing (`applyBuildingIncreases`, `lib/world/tick.ts:554-574`) and
the decay teardown — never joined onto every tick row (`toTickSystems`'s existing per-body scan,
`lib/world/tick.ts:196-204`, is not extended, which is what keeps per-tick cost unchanged);
(2) `TickSystem.yields`/`extractionEff` become rows those two sites write; (3) the tick→world
merge (`mergeSystemsIntoWorld`, `lib/world/tick.ts:268-323`) gains the yield/eff column writes —
today it carries neither, so a recompute that does not reach the merge is a silent no-op. All
other ticks read the cached columns exactly as today (`effOf`/`yieldsOf`,
`lib/engine/resources.ts:199-206`, consumed at `lib/world/tick.ts:255-256`). The recompute is
one fold over ≤~8 bodies for the affected resource, on construction-cycle events only. (The
invariant is stated on its own terms; habitability's quality cache is a looser per-cycle pattern
with a read-side fallback, `lib/engine/habitability.ts:6-11, 134-144`, and is precedent for the
*derived-occupancy idea*, not for this write discipline.)

**Edge behaviour.**

- `n = 0` **with deposits present**: both columns read the **first slot in the order** — the
  best ground, the yield the first extractor would get — mirroring habitability's zero-occupancy
  arm (a seed colony reads its best body's score, not a mean, `lib/engine/habitability.ts:50-53`).
  Neutral 1.0 keeps only its authored meaning, "no deposits of `r` at all"
  (`countWeightedMean`, `lib/engine/resources.ts:110-128`) — it never also means "unworked", so
  the prospecting read (what would this field give me?) survives on every unbuilt resource, in
  the Industry deposit table and the generation-time market seed alike. Output is 0 at `n = 0`
  regardless.
- `n ≥ all slots`: the fold clamps at the all-slots mean of ground values — the same overrun
  rule land quality ships (`systemHabitabilityQuality`'s clamp, habitability.md). Cannot arise
  through play (`computeBuildOptions` rejects past the deposit cap,
  `lib/engine/build-options.ts:88`; Evidence: 0 violations) — defensive for corrupted saves.
- **Unlock/lock re-sorts, and unlock is monotone non-negative on the realised multiplier:** a
  newly unlocked body's slots insert wherever their ground value falls in the order. The worked
  set is the top-`n` slots by ground value and the realised multiplier is their mean; adding
  slots to the candidate pool can only raise or hold a top-`n` mean, so an unlock never reduces
  realised yield — dead by construction, not by tuning. (The decomposed `eff` column alone can
  move either way; only the product carries the guarantee.) A body *locking* (no shipped cause;
  future war/disaster surface) can reduce it — the intended reading of losing ground. Note the
  trigger's real shape: lock state is a static per-archetype class flag, not per-body state
  (`lib/constants/bodies.ts:39-40`, `lib/world/types.ts:281-305` has no lock column), so a
  future unlock is a galaxy-wide class flip re-aggregated per system hosting that class, not a
  per-system mutation.
- **Decay sheds the worst ground first:** `n` shrinking drops slots from the back of the order,
  so the realised multiplier of what remains never falls. A statement about the derivation only —
  decay's own mechanics (which building types shed, when) are untouched.
- **Save/load:** no new `World` fields and no schema change — the existing eff/qual columns
  become a maintained cache. The recompute hook is a pure `rebuildWorkedYieldColumns(world)`
  applied in `deserialiseWorld`'s ok arm (`lib/world/save.ts:67-92`) — the one seam every load
  path (`loadGame`, `lib/services/game.ts:82-88`, worker boot, save-files, the harness) passes
  through — so pre-change saves silently adopt worked-prefix yields before their first tick.
  **`SAVE_FORMAT_VERSION` does not bump**, stated against `save.ts:6-11`'s changed-meaning rule:
  the stored column values are recomputed on load and therefore never read across the version
  boundary.

**Derived per-body read (new), and the marginal-yield display rule.** One pure derivation —
given a system's bodies and extractor counts, return per body and resource: slots worked / slots
total, plus the **marginal slot** (the `(n+1)`th slot in the order — the ground the next
extractor would work). New — emitted by the same engine module that owns the slot order,
consumed by services only, never by the tick. Surfaces: **the headline figure on an Industry
deposit-table row is the marginal yield — what the next extractor built here gets** (at `n = 0`
that is the best slot, so the prospecting read and the headline are one rule); the worked
average — the number production actually uses — is the secondary read beside it ("working 4 of 9
slots · avg 120%"). Owner decision (Kai, 2026-08-25): a stepping-down "next" is
expectation-setting where a sliding-down average reads as decay — accepted in exactly this
shape. Astrography body cards (`components/system/body-card.tsx`) show worked/total per deposit.
The deposit table's underlying figures (`summariseDeposits`, `lib/services/universe.ts:175`)
change value and gain the marginal column; exact wording through `/game-copy`.

**What the simulation observably does differently.** Tier-0 production rises wherever the worked
prefix beats today's pooled product — at the re-measured cohort, 81.8% of worked pairs at 10K
(92.9% at 1K), **median +29.4%, p90 +67.8%, max +184%**, with the quality half the larger
contributor (median +24.4% qual-only vs +4.9% eff-only) and a handful of pairs slightly negative
(3 of 417, min −2.6% — today's product-of-pooled-means can overshoot the honest per-slot mean).
Everything downstream of the columns inherits coherently through the existing parameter graph:
capacity rates, input demand, honest demand, `demandRate` (the pricing anchor,
`lib/tick/adapters/memory/population.ts:156`), logistics classification and the founding seam
(`lib/services/construction.ts:60-61`). The feature's gate is `npm run simulate` at both
horizons, compared against a **pre-change baseline run** (same seed and system count) quoted in
the PR: conservation identities hold; tier-0 output/cover movement read cohorted (producer vs
consumer market role × homeworld vs colony); **plus the two second-order reads this review
added: over-served tier-0 deficits / idle extractor levels (the planner sizes at an assumed 1.0
multiplier, conservative today, optimistic once realised yield exceeds 1) and tier-0 shed
counts** — all against the coarse health bar (no NaN, no runaway, no pinning; dispersion and
liquidity intact).

### Hazard worksheet

**1. One quantity, several jobs** — `npm run impact` pasted (trimmed to non-test modules):

`extractionEff` — 33 refs in 12 tick modules + 7 in 3 read-path services; processors reading via
World interface: directed logistics (6/9), directed build (7/9); undeclared touches: economy
(3/9), population (4/9).

```
industry 9× (engine/industry.ts:455,473,488,493,509,513,724,745,827)
population 4× (tick/adapters/memory/population.ts:123,134,146,156)
good-market-state 4× (:81,:89,:105,:159)   tick 4× (world/tick.ts:256,385,401,921)
market-economy 2× (constants/market-economy.ts:70,74)   honest-demand 2× (:45,:84)
economy 2× (tick/adapters/memory/economy.ts:88,115)     markets 2× (world/markets.ts:23,44)
rows 1× (tick/rows.ts:109)  directed-build-world 1× (:31)  directed-logistics-world 1× (:57)
gen 1× (world/gen.ts:189)
services: system-industry-readout 3× (:71,81,92)  trade-flow 3× (:71,79,88)  construction 1× (:61)
```

`yieldsOf` — 3 refs in 2 tick modules (tick.ts:54,255; resources.ts:199), 8 in 4 services
(construction :24,60; dev-tools :13,188; system-industry-readout :18,70; trade-flow :12,70).
`yieldMult` writer: universe-gen.ts:625 (generation); non-production reader:
economy-type.ts (label derivation).

Ruling: every reader consumes the vectors as "the yield extraction actually achieves", so the
redefinition moves all of them together **deliberately** — that coherence is the feature. The one
reader kept on the *old* meaning is the economy-type label — and that separation is now a named
mechanism, not an assertion: `substrateAggregates`' returns are renamed `potential*` and stay the
label's input at `universe-gen.ts:351/:631`, while the worked fold writes the `WorldSystem`
columns only (see Not claimed for the prefab ordering constraint). The writers change; no read
site changes.

**2. Constants read for their authored meaning:**

| Constant | Docstring says | This spec uses it as | Same? |
|---|---|---|---|
| `extractionModifier` | "Extraction work modifier in (0, 1] — per-body difficulty, kept as its own aggregate (never folded into yieldMult)" (`lib/constants/bodies.ts:37`) | per-slot difficulty term, aggregated in its own vector | yes — the fold set changes, the separation is preserved |
| `qual*` columns | "pure ground-grade multiplier" (habitability.md, Deposit quality) | per-slot grade term, own vector | yes |
| `techLocked` | tech-locked classes contribute zero counts/weight/land (`lib/engine/body-gen.ts:154-156`) | slot-eligibility gate | yes |
| `countWeightedMean`'s neutral 1.0 | "the shared 'nothing here, read neutral' convention" — total count 0 (`lib/engine/resources.ts:110-113`) | "no deposits of `r` at all" ONLY — the unworked-deposits state reads the best slot instead (Edge behaviour) | yes — caught at review; the first draft overloaded it |

**3. Systems sweep** (brainstorm sweep re-verified at spec depth):

| System | Interaction |
|---|---|
| Events | modifiers: none — all economy effects are `production_rate` rate-multipliers applied after yield (`lib/engine/industry.ts:472-474`; verified across `lib/constants/events.ts` at review). Targeting: **indirect** — `targetFilter.economyTypes` (`lib/engine/events.ts:256-257`, spread `:401-403`) reads `economyType`, derived from the pooled potential vector; eight shipped definitions gate on it (mining_boom/asteroid_impact 'extraction', blight 'agricultural', war et al.), so the label MUST stay on the potential vectors (Not claimed) or event targeting shifts galaxy-wide |
| Population + migration | inherits via `demandRate` rewrite (`population.ts:156`) — intended; land fill untouched |
| Unrest / regime | none directly — moves only through satisfaction as any output change does (grep clean at review) |
| Industry + staffing | the changed surface; staffing untouched (labour is head-count, not yield; verified at review) |
| Infrastructure decay | count decreases trigger the refold at the teardown site. The loop the shed rule closes with the idle channel (`infrastructure-decay.ts:6-11`) was traced at review: each shed raises the per-level yield of the remainder, which can re-arm the idle countdown — **damped, not runaway** (total output = Σ top-n ground values, strictly monotone in n), converging to a LOWER equilibrium extractor count at the same demand, freeing deposit slots and cutting maintenance. Fixture-proven (Evidence: 2 sheds/10K — the sim cannot exercise it); the gate reads shed counts and idle tier-0 levels rather than assuming termination |
| Directed logistics | declared reader (6/9) — classification inherits the new rates; no code change |
| Directed build / planner | scoring is yield-blind (`perUnit`, `directed-build.ts:897/1038`; level sizing `Math.ceil(servedOutput / perUnit)` `:1063`) — **unchanged in code, changed in effect**: the assumed 1.0 multiplier is conservative today (realised pooled product < 1) and optimistic once the worked prefix lifts realised yield above 1, so tier-0 commitments over-serve their deficits — surplus output, idle levels, the idle-decay channel arming. Gate reads added (Behaviour). Yield-aware sizing is booked on the planner-necessity roadmap row |
| Colonisation + founding | founding seam reads both vectors (`construction.ts:60-61`) — colonies open with worked-fold yields; intended. Colony target choice unaffected (`colonisation-value.ts:122-166` reads counts+land only; verified at review) |
| Treasury / purse | **indirect but proportional** — production tax is assessed on realised units (`lib/engine/treasury.ts:87-101`), so the tier-0 buff raises faction income roughly in proportion, funding charter fees and build work. Expected observable at the gate: faster founding cadence and higher balances at both horizons; read cohorted, not as a health-bar pass |
| Factions + relations | none — no reader |
| Save format | no shape change; columns become recomputed-on-load cache via `deserialiseWorld`'s ok arm; SAVE_FORMAT_VERSION explicitly not bumped (Behaviour, Save/load) |
| Harness metrics | named exposed bands, not a hedge: `lib/tick-harness/__tests__/runner-founding.test.ts:39-40` (opening satisfaction / deprived colonies), `:62-63` (`demandHunting.flipRate` band 0.005–0.012, two-sided), `:104-110` (`materialsShort` stalls > 0 — a big supply buff can zero them). Each re-derived with reasoning on the implementation branch, never widened to accommodate |

**4. Claims with numbers** — all carried in `## Evidence` (seed 42, 600 systems, t=1K and t=10K,
cohorted homeworld/colony). One labelled inference: *quality-pool dilution mirrors modifier-pool
dilution on unlock* (same all-unlocked-bodies fold, `body-gen.ts:173`) — mechanism is a code
fact, magnitude unmeasured *(hypothesis; immaterial until an unlock mechanic exists, and the
worked fold kills both by the same construction)*.

**5. Signals/primitives consumed:**

| Consumes | Produced at | Shape |
|---|---|---|
| per-body counts/quals | `lib/world/types.ts:289-304` (gen: `lib/world/gen.ts:147-149`) | integers ≥0 / multipliers >0, per resource |
| `extractionModifier` | `lib/constants/bodies.ts` per archetype | (0, 1] |
| built extractor count | `extractorsOnResource` over `world.buildings` (`directed-build.ts:517-524`) | integer ≥0, ≤ deposit cap (Evidence: 0 violations) |
| lock state | `BODY_ARCHETYPES[bodyType].techLocked` | boolean, static classes |
| eff/qual columns | `effOf`/`yieldsOf` (`resources.ts:199-206`) | ResourceVector, this spec's write target |

**6. Aggregates that move for other reasons:** the gate compares against a **pre-change baseline
run** (seed 42, 600 systems, both horizons, taken on main before the change lands and quoted in
the PR beside the post-change run): tier-0 output and cover split by producer/consumer market
role × homeworld/colony cohort. The confound is documented by this spec's own evidence: the
developed cohort grows 20 → 164 between horizons and the homeworld cohort differs from the
colony cohort by ~15 points (92.9% vs 77.6% differing pairs), so any galaxy-wide median moves
with founding-era colony count alone — only the within-cohort comparison is evidence about this
change. 10K is founding era: movement there is recovery-timing, never equilibrium level.

### Falsifiers (provenance: moved here unedited)

Terminal falsifier — committed at `00385c33`, moved unedited:

> **The direction dies if the prefix is indistinguishable from the pool where it matters:** measured
> at the 10,000-tick horizon over developed systems (and re-read at 1,000 ticks for the founding
> cohort), if fewer than ~2% of (system, resource) pairs with built extractors would read a different
> yield under worked-prefix vs pooled mean, AND the median absolute yield difference among those
> pairs is under ~2%, then the mechanical model change is observably inert today — the fill-order
> work collapses to a display-only derivation and the mechanical switch waits for the technology row
> instead of shipping now.

Per-claim falsifiers — committed at `17334243`, moved unedited: see the Measurement plan section
above (claims 1-4). Outcomes recorded in `## Evidence`: all four CONFIRMED.

## Terminal falsifier

**The direction dies if the prefix is indistinguishable from the pool where it matters:** measured
at the 10,000-tick horizon over developed systems (and re-read at 1,000 ticks for the founding
cohort), if fewer than ~2% of (system, resource) pairs with built extractors would read a different
yield under worked-prefix vs pooled mean, AND the median absolute yield difference among those
pairs is under ~2%, then the mechanical model change is observably inert today — the fill-order
work collapses to a display-only derivation and the mechanical switch waits for the technology row
instead of shipping now.
