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

## Terminal falsifier

**The direction dies if the prefix is indistinguishable from the pool where it matters:** measured
at the 10,000-tick horizon over developed systems (and re-read at 1,000 ticks for the founding
cohort), if fewer than ~2% of (system, resource) pairs with built extractors would read a different
yield under worked-prefix vs pooled mean, AND the median absolute yield difference among those
pairs is under ~2%, then the mechanical model change is observably inert today — the fill-order
work collapses to a display-only derivation and the mechanical switch waits for the technology row
instead of shipping now.
