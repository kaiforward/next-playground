# System View

The Astrography tab draws a system as a place: a star at the centre, each body on its own ring
around it. It sits above the body cards, which stay exactly as they are — the rings are a way in,
the cards remain the detail.

Hovering a body surfaces what its card already shows: archetype, habitability band, lock state,
occupancy, habitable land, and each deposit's worked-over-total slot count. Nothing new is computed
for the view; it is a second presentation of `SystemSubstrate`.

## What position means, and what it does not

A body's ring is **cosmetic**. It is rolled once at generation, stored, and read by nothing inside
the tick — no processor branches on it, no yield, danger, growth or logistics term consults it.
Two systems with identical bodies in different ring orders behave identically.

This matters because the view invites a reading it must not earn. A player who sees ices on the rim
and rock near the star will infer that distance causes climate. It does not: an archetype is rolled
from the sun class alone (`rollArchetype`, `lib/engine/body-gen.ts`), and the ring is assigned
afterwards. The arrangement is chosen to look plausible, never to be consulted.

**The rule that keeps it honest:** nothing may read `orbitIndex` except the view that draws it. A
future mechanic wanting real orbital distance introduces its own quantity and says what it means.

## Which ring a body gets

Each archetype carries an **orbital bias** in `[0, 1]` — roughly where that class of world tends to
form, inner to outer. Volcanic and arid worlds sit low, temperate and ocean worlds mid, tundra and
frozen worlds high, gas giants highest. An asteroid belt sits between the rocky classes and the
giants.

Assignment is a **weighted draw, not a sort**. Each body takes a key of `bias + noise`, and the ring
numbers are handed out in that key's order — ring 1 innermost. The noise spread is authored wide
enough that exceptions genuinely happen: a frozen world does turn up close in, a warm one far out.

The spread also sets a ceiling on how far an exception reaches. Two classes swap only when the
difference of their noise draws beats their bias gap, and that difference cannot exceed twice the
spread — so classes far apart on the axis keep their order in every system. Volcanic worlds are
always inward of frozen ones; a gas giant is never innermost. The looseness is real between
neighbours and absent across the extremes, and that is the intended reading rather than a shortfall.

**The roll assigns a field; it never reorders the bodies array.** A body's position in
`world.bodies` is a live contract — `workedByBody` (`lib/engine/worked-deposits.ts`) is keyed by
array index, and the substrate service resolves both worked counts and the potential-yield rows
through that same position. Sorting the array into ring order would silently misalign every deposit
reading in the system. Ring order lives in `orbitIndex` and nowhere else; the array stays as
generated.

That looseness is deliberate and is the design point, not a tolerance. Atmosphere, not distance,
decides how warm a world is: a thick-aired world stays warm a long way out and a bare rock freezes
close in. A hard gradient would erase exactly the cases that make a system look like it has a
history. The bias supplies the tendency; the noise supplies the exceptions.

The roll happens once, at generation, and is stored. It never re-rolls, so a system looks the same
every time it is opened.

## Where on the ring

Placement around a ring is **derived, never stored**: body `i` sits at `i × 137.5°`. Successive
bodies land far apart, never collide, and never bunch on one side. Because the angle comes from the
body's index, the arrangement is identical on every render, across saves, and across sessions —
there is no angle to persist and nothing to keep in sync.

## What is drawn

- **The star**, centred, coloured by sun class.
- **One ring per body**, innermost outward. Bodies never share a ring, so the ring count is the body
  count (two to eight).
- **Bodies as plain coloured circles**, radius from `WorldBody.size`. That field is authored as
  display flavour only; this is its first reader, and it still drives nothing.
- **An occupied body** carries the same green marking the body card uses for the fill-best-first
  occupied prefix; a **locked** body is drawn dashed and reads as present but not yet usable.
- **An asteroid belt is drawn as its own dashed ring** rather than a circle on one. It is the one
  body that was never a point.

Archetype iconography is deliberately absent. Colour and size carry the whole visual difference; the
name is in the label and the detail is in the hover.

## Fitting the panel

The system panel is a fixed 560px column (`components/ui/detail-panel.tsx`), which rules out any
layout that grows sideways with body count. Rings grow inward instead: eight rings still separate
cleanly inside the panel's usable width, and the diagram stays square whatever the body count.

## What this does not claim

- **No orbital mechanics.** There is no period, no eccentricity, no motion, and no distance in any
  unit. A ring is an ordinal, not a measurement.
- **No inner/outer effect on anything.** Ring index reaches no engine term.
- **No new data for the hover.** Everything it shows already exists on `BodyView`.
- **Nothing about invasion.** Invasion concerns which bodies a system has, not where they sit.

## Save and generation

`orbitIndex` is an additive optional field on the body row, so an old save loads without it. A body
that has none is drawn in array order — correct rather than absent, and self-corrects for every
world generated afterwards.

Adding the roll changes generated output, so seeds produce different galaxies than before. That is
expected: generation changes are verified by intrinsic coherence, never by parity with previous
output.
