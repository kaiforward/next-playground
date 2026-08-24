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

## Terminal falsifier

**The direction dies if the prefix is indistinguishable from the pool where it matters:** measured
at the 10,000-tick horizon over developed systems (and re-read at 1,000 ticks for the founding
cohort), if fewer than ~2% of (system, resource) pairs with built extractors would read a different
yield under worked-prefix vs pooled mean, AND the median absolute yield difference among those
pairs is under ~2%, then the mechanical model change is observably inert today — the fill-order
work collapses to a display-only derivation and the mechanical switch waits for the technology row
instead of shipping now.
