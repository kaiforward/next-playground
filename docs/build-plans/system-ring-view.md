# System ring view — working file

## Spec

`docs/active/gameplay/system-view.md` (promoted on this branch), with its entry in `docs/SPEC.md`.

Pure UI plus one cosmetic generation field that no mechanic reads, so `/spec-review` was skipped by
owner decision — the gate's own test (economy, tick processors, changed signals or primitives) finds
no surface here.

## Build plan

### Resolution — every measure the spec promises

| Measure | State | Producer / citation |
|---|---|---|
| Archetype orbital bias | new | Task 1 |
| Ring-roll noise spread | new | Task 1 |
| `GeneratedBody.orbitIndex` | new | Task 2 |
| `WorldBody.orbitIndex` | new | Task 2 |
| `BodyView.orbitIndex` | new | Task 3 |
| `BodyView.size` | new | Task 3 |
| Ring radius / centre / body position | new | Task 4 |
| Golden-angle step (137.5°) | new | Task 4 |
| `WorldBody.size` | exists | `lib/world/types.ts:334` |
| Body count 2–8 per system | exists | `SunClassDef.bodyCount`, `lib/constants/bodies.ts:204,215,222,233` |
| `BodyView.archetypeName` | exists | `lib/types/api.ts:268` |
| `BodyView.score` (habitability band input) | exists | `lib/types/api.ts:272` |
| `BodyView.locked` | exists | `lib/types/api.ts:274` |
| `BodyView.workedCounts` | exists | `lib/types/api.ts:282` |
| `BodyView.peopleLand` | exists | `lib/types/api.ts:285` |
| `BodyView.occupied` | exists | `lib/types/api.ts:289` |
| Habitability band from score | exists | `habitabilityScoreBand`, `lib/utils/substrate.ts` |
| Per-deposit name / band / worked / total | exists | `bodyDepositFeatures`, `lib/utils/substrate.ts` |
| Sun-class colour | exists | `SUN_CLASS_COLORS`, `lib/constants/ui.ts` |
| Panel width (560px) | exists | `components/ui/detail-panel.tsx:14` |
| Asteroid belt archetype id | exists | `lib/constants/bodies.ts:147` |
| Body-array-index contract | exists | `workedByBody`, `lib/engine/worked-deposits.ts:251-265`; consumed at `lib/services/universe.ts:130-141` |

---

### Task 1 — Author each archetype's orbital bias and the roll's noise spread

Files: `lib/constants/bodies.ts`, `lib/constants/__tests__/band-constants.test.ts`

Interface: `BodyArchetype.orbitalBias: number` — a required field on all twelve archetypes, in
`[0, 1]`, "roughly where this class of world tends to form, inner to outer". `ORBIT_ROLL_SPREAD:
number` — the half-width of the uniform noise added to the bias at roll time, authored as "how often
the tendency is allowed to fail".

Proves:
- An archetype whose bias sits outside `[0, 1]` is not caught by the type alone.
- The record is not total — a newly added archetype without a bias compiles.
- The authored ordering does not hold: a gas giant does not sit outward of a temperate world, or a
  volcanic world does not sit inward of a frozen one.
- `ORBIT_ROLL_SPREAD` is zero, which would silently convert the weighted draw into a hard sort and
  erase every exception the spec requires.

Consumes: nothing.

---

### Task 2 — Roll the ring index at generation, without touching array order

Files: `lib/engine/body-gen.ts`, `lib/engine/__tests__/body-gen.test.ts`, `lib/world/types.ts`,
`lib/world/gen.ts`, `lib/world/__tests__/save.test.ts` (round-trip only)

**Sibling walk — deliberately shorter than a system field's.** A persisted field on `WorldSystem`
needs the tick joins, the merge delete/assign and the resettlement clears. `WorldBody` needs none of
them: bodies are not tick rows (`lib/tick/rows.ts` carries no body shape), nothing in the tick
mutates them, and `save.ts`'s load guard spot-checks only that `world.bodies` is an array rather than
validating per-field. So this field's whole surface is the generator, the type, the `gen.ts` mapping
and the round-trip test. An implementer should not go looking for join/clear plumbing that does not
exist for bodies.

Interface: `GeneratedBody.orbitIndex: number` — `1..n` over a system's bodies, each value used once.
`WorldBody.orbitIndex?: number` — optional and additive, carried through `gen.ts`'s body mapping
(`lib/world/gen.ts:147-155`). The roll consumes the same seeded `RNG` already threaded through
`generateSubstrate`; no new randomness source.

Proves:
- Indices are not a permutation of `1..n` — a gap or a duplicate leaves two bodies on one ring.
- The roll reorders `bodies`, breaking the array-index contract `workedByBody` and the substrate
  service depend on.
- The tendency does not hold in aggregate across many seeds — outward-biased archetypes are not
  outward more often than inward.
- The tendency holds *absolutely*, with no exceptions across many seeds — the hard-sort failure the
  spec exists to prevent.
- The same seed produces different indices on a second run.
- The field does not survive a save/load round trip.

Consumes: Task 1.

---

### Task 3 — Carry ring index and size onto the body read model

Files: `lib/types/api.ts`, `lib/services/universe.ts`, `lib/services/__tests__/universe.test.ts`

Interface: `BodyView.orbitIndex: number` and `BodyView.size: number`, both required on the view type
(the service resolves absence, so no consumer branches on it). Where `WorldBody.orbitIndex` is
absent — a save predating the field — the service substitutes the body's array position, so an old
save draws in generation order rather than losing the view.

Proves:
- An old save (no stored `orbitIndex`) yields no view, or an unstable one that changes between reads.
- The absence fallback collides — two bodies resolving to the same ring.
- `workedCounts` stops aligning with its body once the fallback path is taken.
- `size` is defaulted or coerced rather than passed through.

Consumes: Task 2.

---

### Task 4 — Ring geometry as a pure, node-tested helper

Files: `components/system/ring-layout.ts` (new), `components/system/__tests__/ring-layout.test.ts`
(new)

Interface: `ringLayout(bodies: BodyView[], size: number): RingLayout` returning the star's centre and
radius plus, per body, its ring radius, centre coordinates and drawn radius, keyed by body id. The
angle for a body is derived from its `orbitIndex` alone. Nothing is stored and nothing is random.

This task exists separately because the component may not be tested on geometry: jsdom has no layout,
so a co-ordinate asserted through a rendered attribute is exactly the vacuous test AGENTS.md names —
the maths moves here, where it is a real value in a node test. The `.ts` / `.tsx` split mirrors the
existing `provision-view.ts` / `provision-block.tsx` precedent in this directory.

Proves:
- Two bodies resolve to the same ring radius, or to overlapping drawn circles.
- Successive bodies land at the same angle, or bunch within a narrow arc instead of spreading.
- The layout is not stable — the same input yields different co-ordinates across calls.
- A body's drawn radius ignores `size`, or a zero/extreme `size` produces a non-finite or negative
  radius.
- The eight-body case exceeds the available square, silently clipping the outermost ring.
- Ring order does not follow `orbitIndex` — the innermost ring is not ring 1.

Consumes: Task 3.

---

### Task 5 — The ring diagram, wired into the Astrography tab

Files: `components/system/system-rings.tsx` (new),
`components/system/__tests__/system-rings.test.tsx` (new),
`components/panels/system-astrography.tsx`

Interface: `SystemRings({ bodies, sunClass }: { bodies: BodyView[]; sunClass: SunClass })`, rendered
in `SystemAstrography` above the existing body-card grid and below the star summary card. Consumes
`ringLayout` for every co-ordinate; computes none of its own.

Reuse:
- `Popover` / `PopoverTrigger` / `PopoverContent` (`components/ui/popover.tsx:223-263`) — props read:
  `openDelay`, `side`, `align`, `clickInert`, `pointerInert`. Hover-to-open without stealing focus,
  keyboard-reachable content, and one-open-at-a-time exclusivity are all already implemented; the
  keyboard convention (ArrowDown enters, Escape returns) comes with it.
- `BodyCard` (`components/system/body-card.tsx:21`) — props read: `{ body: BodyView }`. It is the
  popover's entire content. Reusing it rather than authoring a second body summary is what makes
  "the hover shows what the card shows" true by construction instead of by discipline.
- `SUN_CLASS_COLORS` (`lib/constants/ui.ts`) for the star's fill.
- `SectionHeader`, `Card` (`components/ui/`) for the surrounding block, matching the tab's existing
  sections.
- New: `SystemRings` — searched for an existing spatial/diagram/orbit/ring renderer under
  `components/` and found none; the map's renderer is Pixi/WebGL over the galaxy graph and shares no
  surface with an inline SVG panel diagram.
- `StarGlyph` (`components/system/star-glyph.tsx:25`) is deliberately **not** reused: it renders a
  `<span>` with CSS gradients and cannot be placed inside the SVG. The star mark here is an SVG
  circle taking the same `SUN_CLASS_COLORS` entry, so the two agree on colour without sharing markup.

Proves:
- A locked body renders without its locked marking, or an occupied one without its occupied marking.
- An asteroid belt renders as a body circle rather than its own ring.
- Hovering a body opens no popover, or opens one naming a different body.
- Two bodies' popovers can be open at once.
- The diagram renders when `bodies` is empty, or throws instead of standing down.
- Body count and ring count disagree.

Consumes: Task 4.

---

## Verification

- **`npm run build`** — the build gate (`tsc && vite build`).
- **`npm run simulate`, both horizons.** This changes generated output, so the run is not looking for
  a moved metric — it is proving that generation still produces coherent galaxies and that every
  conservation identity still passes with the new roll in the loop. Read at 1,000 and 10,000 ticks,
  as always.
- **Seeds change by design.** Verification is by intrinsic coherence, never parity with previous
  output; any baseline comparator in `temp/` is stale from this branch onward and should be
  regenerated rather than diffed against.
- **One browser smoke.** The whole feature is a rendered diagram inside a fixed-width panel, and
  jsdom has no layout — a ring that overflows the panel or a popover that opens off-screen is
  invisible to every test in the suite. Open a system's Astrography tab, at both a two-body and an
  eight-body system.

## Doc fold

- `docs/active/gameplay/system-view.md` — written on this branch; already current.
- `docs/SPEC.md` — System View section added on this branch; already current.
- `docs/active/gameplay/habitability.md` — check for any claim that bodies have no spatial
  representation, and correct it if present.
- `docs/ROADMAP.md` — delete the queued row on the PR that finishes this work.
- This working file is deleted at ship, after the fold.

## Not covered

- **Archetype iconography** — dropped by owner decision: plain coloured circles for now, colour and
  size carrying the whole visual difference.
- **Motion, orbital animation, 3D** — dropped. The spec commits to a static square diagram; the
  roadmap row's "2D/3D" wording is settled as 2D.
- **Any mechanic reading `orbitIndex`** — dropped, and stated as a standing constraint in the spec.
  A mechanic wanting real orbital distance introduces its own quantity.
- **Re-rolling ring indices for existing saves** — dropped. Task 3's array-position fallback means an
  old save draws correctly in generation order; a migration would change a stored world for a purely
  cosmetic gain.
- **Selecting a body from the diagram** (click-to-focus, deep links) — booked: nothing exists to
  select *into*, since bodies carry no panel of their own. Revisit alongside the full construction
  screen row in `docs/ROADMAP.md`, which is the first thing that would want per-body navigation.

## Net-new UI

- `SystemRings` (`components/system/system-rings.tsx`) — the ring diagram itself.
- `ringLayout` (`components/system/ring-layout.ts`) — its pure geometry helper, not a component.

Nothing else. The hover is `Popover` composed with the existing `BodyCard`, so the feature adds one
visual surface, not a family of them — and that surface is the one the approved prototype shows.
