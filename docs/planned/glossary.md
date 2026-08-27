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

- **These are dictionary entries, not prose. Define, don't sell.** No sentence whose job is to
  reassure the player or set a mood — mood belongs to events, missions and story text, where it
  does real work. Context appears only where the definition genuinely needs it, and usually by
  naming another term rather than explaining one.
- **One concept per entry, kept as short as it will go** — one self-contained sentence where that
  works. An entry earns a second only when the first leaves a real question about what the thing
  is. An entry never explains a second term inline; it names it and leaves it to that term's own
  entry.
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
- **Yield.** Potential yield covers every resource slot, quality-weighted. Realised yield covers only
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
- **Band** keeps its word. Provision bands, resource quality bands and budget bands never appear on
  the same screen, and each carries a visible qualifier already. The price band and logistics'
  dead-band are engine-side.

### Terms that collapsed

Two names for one concept is a finding, and the loser does not come back.

- **Pop is not a unit; population is the term.** There is no discrete pop anywhere — `population`
  is a plain number (`lib/types/game.ts`), and "pops" in code means per-system population rows.
  "Pop" survives as informal English for people, with no entry of its own.
- **A building's count is its number of levels** — the Industry ledger renders staffed levels over
  `count` in one cell (`components/system/industry-panel.tsx`). One entry, not two.
- **Deposit retires; the words are resource and slot.** The Industry ledger's own header row ran
  `Deposit | Staffed | Slots | Yield | Out/cyc` (`components/system/industry-panel.tsx`) — two words
  for one thing, six characters apart. A *resource* is one of the seven kinds a body's ground holds
  (`ResourceType`, `lib/types/game.ts`); a *resource slot* is one workable place holding one of
  them. The ledger's name column becomes Resource, Slots keeps its column, and "deposit" leaves the
  vocabulary entirely rather than staying as a demoted synonym.
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

**Ground** — body, archetype, settled, habitability, settled habitability, resource, resource slot, quality
band (poor / average / good / rich), potential yield, realised yield, worked, locked, orbit
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

**Cycle** — Six days. The period all slow change is measured over, and the basis of any rate
written "per cycle".

**Day, month, year** — Thirty days to a month, twelve months to a year. Dates count from 2350.

**UST** — Universal Standard Time. The time standard kept across every world.

**Development points** — A measure of how built up a system is, counting population, licensed
skilled work and staffed industry, weighted toward advanced industry.

### People

**Population** — The people living in a system. It is a single pool that every job draws on;
skill is not a kind of person.

**Pop cap** — The population a system's housing can hold.

**Housing** — The buildings people live in. They are the only buildings that take habitable land,
and the only thing that raises pop cap.

**Occupancy** — How full a system's housing is: its population against its pop cap.

**Habitable land** — The ground a body offers for settlement, and the budget housing is built
against. Only bodies habitable enough to settle carry any.

**Workforce** — A system's population counted as labour — everyone available to work, at any grade.

**Unskilled, technician, engineer** — The three grades of work a job can call for. A building's
staffing is a fixed split across the three, and the same people fill whichever grade they are
licensed for.

**Skill ceiling** — The limit on how many people may work at a skilled grade, set by the system's
academies. Jobs above the ceiling stay empty however large the population is.

**Academy** — A vocational school or a research institute. Neither produces a good; each raises one
skill ceiling, and together they are the licensing family in the industry and construction ledgers.

**Staffing** — The people a building needs to run. A building whose jobs are half filled produces
half as much.

**Unemployment** — People housed and fed but working no job, either because none is built or
because no skill ceiling licenses them for it.

**Migration** — Population moving between a faction's own developed systems, toward the calmer,
emptier and more job-rich ones. Nobody moves toward a world in Famine.

**Colonist delivery** — Spare population routed from established systems out to a faction's
emptiest colonies, and the main way a new colony fills.

**Abandonment** — The end of a colony whose population falls below one pop, famine or not. Its
buildings are lost and the system reverts to unclaimed frontier, claimable again.

### Wellbeing

**Provision** — The share of what a world needs that actually arrives, weighted by how badly it
needs each good.

**Expectation** — The Provision a world's population has grown accustomed to. Standards rise
quickly in good times and resign slowly in bad ones.

**Grievance** — How far a world's Provision falls short of its own expectation, which is what
unrest answers to rather than the distance from perfection.

**Supplied, Strained, Rationing, Deprived** — The four bands a world's Provision falls into, best
to worst. They are description only: no rate or effect keys off the band.

**Famine** — Water or food below the survival line. It reads in place of the four bands at any
Provision, and it is the one supply state severe enough to collapse a world on its own.

**Unrest** — How angry a world is. It climbs and falls gradually toward the level its causes
justify: grievance, tax pressure and crowding.

**Stability** — The calm of a world, read as the inverse of its unrest.

**Strike** — The work a world stops doing once unrest is high enough. Production falls further the
higher unrest climbs; consumption never falls with it.

**Survival goods** — Water and food. A world short of either is in Famine.

**Need** — One good a world's civilians want, and how much of it they want per cycle. Industry's
draw on the same good is counted separately.

**Satisfaction** — The share of one good's demand that was delivered last cycle.

### Ground

**Body** — A planet, belt or gas giant in a system. Everything physical a system has to offer sits
on one.

**Archetype** — A body's climate class, on a spectrum from frozen through temperate to volcanic. It
fixes the body's habitability, its habitable land, and which resources it can hold.

**Settled** — Marks a body people live on.

**Habitability** — How well a body's ground supports ordinary life, as a percentage of normal. A
body below the settleable line offers no habitable land at all.

**Settled habitability** — A system's own habitability figure: the land-weighted mean across the
bodies its population actually occupies, best body first. It falls as population spreads onto worse
worlds, and it multiplies population growth.

**Resource** — One of the seven kinds of thing a body's ground holds: gas, minerals, ore, biomass,
arable, water or radioactive.

**Resource slot** — One workable place on a body holding one resource. A body's slot count for a
resource is how many it holds, and one extractor level works one slot.

**Quality band** — How rich a body's slots of a resource are: poor, average, good or rich. It
multiplies what an extractor working them yields.

**Potential yield** — What a system's ground is worth with every slot of a resource worked,
locked bodies included.

**Realised yield** — What the slots a system's extractors actually sit on are yielding.
Extractors take the best ground first, so realised yield opens above potential yield and falls
toward it as the field fills.

**Worked** — Marks the slots a system's built extractor levels are on, best ground first.

**Locked** — Marks a body no technology can reach yet. Its slots count toward potential yield
and can never be worked.

**Orbit ring** — Which ring out from the star a body is drawn on. Decoration: nothing in the game
reads it.

**Star class** — A system's sun, from red dwarf through orange and yellow to blue-white. It decides
which archetypes can form there, and two of the four classes can hold no settleable body at all.

**Danger** — A system's hazard rating, from its government and the kinds of body it holds. A
readout only; nothing acts on it yet.

### Industry

**Building** — One kind of works a system has put up: an extractor, a factory, housing, an academy,
a specialisation complex or a construction centre. A building's count is its number of levels, and
every figure on its row scales with them.

**Built, staffed, free** — The three readings on an industry row: levels standing, levels actually
worked, and the room left to build into. For housing the middle reading is occupancy; for academies
and complexes it is how much of what they license or buff is drawn on.

**Decay** — The steady loss of building levels a system is not using. It only ever removes levels,
and high unrest tears them down even while they are in use.

**Idle reason** — The one constraint holding a building's idle levels back: staffing, a skill
ceiling, missing recipe inputs, output it cannot sell, or empty housing.

**Recipe** — What one unit of a good is made from. Every good above raw has one.

**Input gate** — How far below full output a building runs for want of a recipe input. A shortage
passes down the chain, throttling every good made from the good it throttled.

**Tier: raw, processed, advanced** — What a good is made from. Raw goods come out of the ground,
processed goods are made from raw ones, advanced goods from processed. Everything above raw needs
skilled work.

**Family** — One of the five groups the processed and advanced goods fall into: heavy industry,
chemicals, electronics, armaments and consumer goods. Each has its own specialisation complex.

**Specialisation complex** — A building that produces nothing and raises the yield of every good in
its family made in that system. A system may hold one complex, of one family.

**Stable, idle, contracting, collapsing** — The four health states of a building. Stable is
holding; idle is a whole level doing nothing for want of a recipe input, which decay cannot see;
contracting is a whole level decay is about to shed; collapsing is unrest tearing levels down.

### Trade and money

**Stock** — How much of a good a system's market is holding.

**Price** — What a good fetches at one system's market. It rises as stock falls short of what that
system demands and falls as stock builds up, within a floor and a ceiling that market sets itself.

**Demand** — How much of a good a system wants per cycle, its people's needs and its factories'
recipe draw together.

**Surplus** — More of a good than a system needs to keep in hand, and so drawable by a haul.

**Deficit** — Less of a good than a system needs in hand, and so a target for a haul.

**Haul** — One shipment of a good from a faction's own surplus to one of its own deficits. Hauls
are the only way goods move between systems.

**Treasury** — A faction's money: what its taxes collect, what its bills drain, and what it has
left. Every faction runs one.

**Tax level** — A faction's tax stance, in five steps from very low to very high. A higher step
collects more from the same activity and raises unrest on every world the faction owns.

**Budget band** — One of the three things a faction spends on: maintenance, logistics and
construction. Each has a slider setting what share of that band's bill the faction is willing to
pay, and the three are settled in that order with nothing on credit.

**Funded fraction** — The share of a band's bill that was actually paid. It sets how much of that
band's work runs the following cycle: money is fuel, so it can starve a band but never push one
past what it could physically do.

**Charter fee** — The one-off price of committing to a colony, taken off the treasury before the
budget bands divide anything.

**Manifest** — The goods a colony is stocked with while it is being founded, staged and paid for
cycle by cycle and credited to its market when it opens.

### Territory and politics

**Unclaimed, controlled, developed** — The three states a system can be in. Unclaimed is open
frontier, controlled is claimed but unsettled, and developed is a live colony — only a developed
system has population, a market or industry.

**Claim** — Stake an unclaimed system as controlled. A claim is cheap and near-instant, and it
takes the ground without settling it.

**Found** — Settle a controlled system into a live colony, turning it developed. It is paid for
with a charter fee, a manifest and construction work, and it takes time to finish.

**Faction** — One of the powers dividing the galaxy, the player's own included. Each holds
territory, runs a treasury, and expands and builds by the same rules as the rest.

**Government** — A faction's form of rule, one of eight. It shapes the faction's economic
character, its default tax level and which events find it.

**Doctrine** — A faction's political temperament, one of five. It biases who a faction will ally
with and how readily it reaches for force.

**Faction status** — How large a faction stands against every other: dominant, major, regional or
minor. It follows from expansion and is never assigned.

**Relation score** — How two factions regard each other, from -100 to +100. It drifts on shared
borders, doctrine, government, trade and standing alliances, and peace left unmaintained drifts
downward on its own.

**Allied, friendly, neutral, unfriendly, hostile** — The five tiers a relation score falls into.
Dropping to unfriendly opens border conflicts; holding high enough for long enough allows an
alliance.

**Alliance** — A standing pact between two factions, formed after a period of negotiation at a high
relation score and dissolved when the score falls back.

**Region** — A named division of the map that a system belongs to. It orients the player and
carries a dominant-economy label; it does not bound anyone's territory.

**Jump lane** — A connection between two systems. Goods, people and ships all move along lanes and
nowhere else.

**Fuel cost** — What crossing one jump lane costs. It sets how far hauls and migration reach, and
gateway lanes cost the most.

**Gateway** — A system holding the lanes between two regions, and the chokepoint anything crossing
that border must pass.

### The player's layer

**Automation switch** — A per-domain toggle on the player's faction. With building or colonising
switched off the faction proposes no new work of that kind; work already committed carries on, and
orders given by hand always do.

**Pin** — A system the player has marked to keep in the Tracker.

**Tracker section** — One of the Tracker's three lists — pinned systems, building, colonising —
each of which can be shown or hidden.

**Alert category** — One condition the alert bar watches for. Its chip appears the moment anything
matches and clears the moment nothing does.

**Critical, important, informational** — The three tiers alert categories are ordered by. Critical
is always shown and cannot be hidden.

**Funded front** — The construction work a faction's pool is actually paying for this cycle.
Anything behind the front is queued but not progressing.

**Ghost row** — A building still under construction, shown in the industry ledger where it will sit
once it is finished, with its progress and an estimated finish.

## Still open

- Rendering dates with the `UST` stamp — decoration over the existing calendar
  (`lib/constants/calendar.ts` is display-only), so it rides the language pass, and it is cheap to
  drop again if it does not land.
