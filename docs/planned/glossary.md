# Glossary — the game's vocabulary

One definition per term, in plain language, written once and quoted everywhere. Tooltips, popovers
and tutorials all draw from here; nothing defines a term a second time in its own words.

This doc is the reference the player can open directly, and it is also the source the tooltip
migration links to. It is written before the deep-tooltip system so that migration has something to
point at.

## What earns an entry

**Every quantity that has a name on screen** — not only the strange words. The exotic terms
(Provision, cover, control ladder) are not where players get misled; the overloaded ordinary ones
are. A word like "occupancy" reads as obvious, which is exactly why two tabs meaning different
things by it goes unnoticed. Under this test each such word gets one definition, and any surface
that departs from it has to say so on the surface.

Engine vocabulary does not earn an entry — see *Words that stay inside the engine* below.

## How an entry is written

- **One concept per entry, kept as short as it will go** — one self-contained sentence where that
  works, two where the second genuinely earns its place. An entry never explains a second term
  inline; it names it and leaves it to that term's own entry.
- **Named, not explained.** This is what makes term-linking possible later without rewriting
  entries: "how habitable this system is to your *pops*" links *pops* rather than defining it.
- **The tooltip either explains the term's relevance in that context, or shows this definition
  directly.** Context-specific meaning is the only reason a tooltip writes its own words.

## Rules the vocabulary is held to

### Qualifiers, not renames

Where one word carries two meanings, the fix is almost always the qualifier that is currently
living in a code docstring, moved onto the screen. The word survives; the thing that was invisible
becomes the reason the qualifier exists.

- **Habitability.** A body's habitability is its archetype's static rating. The system-level figure
  is a different quantity — the land-weighted mean score across the bodies the population *actually
  occupies*, best world first (`lib/engine/habitability.ts`). It is a property of where people are
  sitting, not of the system's ground, and it moves as population spreads onto worse worlds. It
  reads as **settled habitability**; the plain word stays with the body.
- **Yield.** Potential yield covers every deposit slot, quality-weighted. Realised yield covers only
  the worked prefix (`lib/engine/body-gen.ts`). The adjective is mandatory on screen wherever both
  can be met. A specialisation complex's family yield multiplier and the Industry tab's realised
  output units are separate readings that keep their own words.
- **Development is not overloaded.** Development points and a developed system share a root but
  follow from each other — a developed system is the only way development increases, so a developed
  system always carries some. No rename.
- **Demand and staffing are separate words, not two senses of one.** Demand is goods: how much of
  a good a world wants per cycle, its people and its factories together. The labour side is
  *staffing*, which is already the word for it everywhere else. Two screens currently blur them —
  the skilled-basket tooltip's "adds demand for: <goods>" reads as consumption and becomes
  "consumes", and the build dialog's "adds labour demand" sits one clause after "Staffing
  shortfall" and becomes "adds jobs your population can't fill". Neither needs a qualifier once
  the words don't overlap.
- **Occupancy is fullness; a body is settled.** Occupancy keeps the fill meaning — how full a
  system's housing is, population against pop cap (the population-summary occupancy bar). The
  body-level badge for "people live here" is a different fact and reads **Settled**
  (`components/system/body-readout.tsx`), which also puts the badge and *settled habitability* on
  the same word: that figure is the mean across exactly the bodies the badge marks.
- **Workforce means people, not buildings.** The construction readout labels schools and institutes
  as the "workforce" family (`lib/engine/construction-readout.ts`), which collides with the labour
  pool. The family is renamed **licensing** — what both of its lines already say it does — and
  workforce is the people.
- **Band** keeps its word. Provision bands, deposit quality bands and budget bands never appear on
  the same screen, and each carries a visible qualifier already. The price band and logistics'
  dead-band are engine-side.

### Terms that collapsed

Two names for one concept is a finding, and the loser does not come back.

- **Pop is not a unit; population is the term.** There is no discrete pop anywhere — `population`
  is a plain number (`lib/types/game.ts`), and "pops" in code means per-system population rows.
  "Pop" survives as informal English for people, with no entry of its own.
- **A building's count is its number of levels** — the Industry ledger renders staffed levels over
  `count` in one cell (`components/system/industry-panel.tsx`). One entry, not two.
- **Shortfall is plain English, not a defined term.** The measure is *satisfaction*, the fraction
  of a need met (`components/system/needs-view.ts`); a shortfall is just what is missing from it,
  and the screen already words the satisfaction number that way ("pops short 42%").

### An allowance never goes inside a displayed number

A displayed figure shows the real quantity. Where a mechanic works against a tolerance, the
tolerance stays inside that mechanic and surfaces through the state it already drives — never by
inflating the number the player reads.

The case this rule comes from: the Industry ledger's in-use column is not occupancy or staffing. It
is `buildingUsed` (`lib/engine/industry.ts`), the decay engine's keep-or-shed verdict, and it folds a
10% vacancy allowance for housing (`VACANCY_SLACK`) and a 15% selling allowance for production rows
(`USED_SLACK`, `lib/constants/infrastructure.ts`). Every row in that ledger therefore saturates
before the thing is actually full — housing reads 379 / 379 at 91% real occupancy.

The fix is not to remove the allowance and not to rename the column. The panel **already** carries
decay's verdict as the row's health colouring (stable / idle / contracting / collapsing), so the
in-use number is a second, worse copy of it. The column shows the true figure; the colour says
whether decay is eroding the level. The allowance stays inside decay, invisible.

## Words that stay inside the engine

Real concepts the tick needs, that teach a player nothing and must never reach a tooltip: eligible
heads, work budget, cover (and every `*_COVER` threshold), the use figure vs the draw figure,
frontier index, dead-band, tick. Where a player needs the idea behind one of these, it is expressed in the
player's own terms on that surface, not by exposing the engine's word.

## Term inventory

Candidates, grouped by where a player meets them. Many will collapse — two names for one concept is
itself a finding, and anything on the engine-only list above drops out.

**Time and scale** — cycle, day / month / year, UST, development points.

**People** — population, pop cap, housing, occupancy, habitable land, workforce, unskilled /
technician / engineer, skill ceiling, academy licence, staffing, unemployment, migration, colonist
delivery, abandonment.

**Wellbeing** — Provision, expectation, grievance, the four Provision bands (Supplied / Strained /
Rationing / Deprived) and Famine, unrest, stability, strike, survival goods, need, satisfaction.

**Ground** — body, archetype, settled, habitability, settled habitability, deposit, deposit count, quality
band (poor / average / good / rich), potential yield, realised yield, worked slots, locked, orbit
ring, star class, danger.

**Industry** — building, level count, built / in-use / available, decay, idle reason, recipe, input
gate, tier (raw / processed / advanced), family, specialisation complex, the four health states.

**Trade and money** — stock, price, demand, surplus, deficit, haul, route cost, treasury, tax level, budget
band, funded fraction, charter fee, manifest.

**Territory and politics** — unclaimed / controlled / developed, claim, develop, found, faction,
government, doctrine, faction status, relation score and its five tiers, alliance, pact, region,
gateway, jump lane, fuel cost.

**The player's layer** — automation switch, pin, tracker section, alert category and its three
tiers, funded front, ghost row.

## Definitions

### Time and scale

The calendar keeps real-world unit names because it very nearly keeps their lengths — a 30-day
month and a 360-day year are within 1.5% of real, so the player's own intuition about how long a
year feels is free and correct. The one unit that does deviate is the six-day week, and it is
already called a cycle rather than a week. Tick is engine-only: everything a player reads is
denominated per cycle.

**Cycle** — Six days, and the span everything slow is measured over: goods bought and sold, people
born and moved, buildings worn down. Any rate written "per cycle" is measured against this.

**Day, month, year** — The date on screen: thirty days to a month, twelve months to a year,
counted from 2350.

**UST** — Universal Standard Time, the clock every world keeps regardless of how fast its own
planet turns, and the reason a day means the same thing across the galaxy. Dates read
`2350.04.12 UST`.

**Development points** — How built up a system is: its people, the skilled work its academies
license, and the industry it actually keeps staffed, with advanced industry counting for more than
raw.

## Still open

- Writing the remaining seven groups of definitions.
- Rendering dates with the `UST` stamp — decoration over the existing calendar
  (`lib/constants/calendar.ts` is display-only), so it rides the language pass, and it is cheap to
  drop again if it does not land.
