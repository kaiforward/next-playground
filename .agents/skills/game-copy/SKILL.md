---
name: game-copy
description: Write player-facing text — labels, stats, tooltips, popovers, badges, empty states, event text. Use whenever a task adds or changes any string a player reads, and when reviewing UI work for copy quality.
---

# /game-copy — the words players read

Every string a player reads is copy, and copy is written in one of three registers. The first
job on any surface is deciding which register it is; the second is writing inside that
register's rules. When a component mixes registers, each piece keeps its own register — a stat
line stays a stat line even when a flavor sentence sits under it.

## The three registers

**1. Stat register** — anything that describes a mechanic: headline stats, modifier lines,
bar labels, badges, table cells. The genre grammar (EU5/Stellaris): a game noun plus a number.

- Form: `Habitability: 85%` · `Unrest: +12%` · `Slots: 3 worked / 5` ·
  `Habitable land: 220 free`.
- **A signed modifier is only honest alongside the others it competes with.** Where a figure is
  the sole input to an outcome, stating it twice — once as the level, once as the modifier it
  implies — reads as two facts and misleads at the neutral end: an unpenalised system rendered
  "0%" looks like it has none of the thing, not full measure of it. State it once, as the level.
- No verbs, no metaphors, no sentences. The noun is a game term of art; the number is a
  percentage of normal, a signed modifier, or a plain quantity with its unit visible in the
  label.
- **Modifiers are signed percentages and they stack additively.** `−15% pop growth` is a
  promise about arithmetic: when several modifiers apply, their percentages sum before
  applying. A mechanic whose maths can't honour that doesn't get a modifier line until it can
  (design conforms to the display; the display never lies about the maths).
- A tooltip on a stat is a breakdown, not an essay: the headline stat, then one modifier line
  per source, each in this same register.

**2. Keyword register** — the definitional tooltip behind a hoverable game term (the word
"Habitability" itself, not its number). This is where the player who needs more gets more:
one to three sentences saying what the thing *is* in the world, with a little flavor, then —
only if needed — one sentence of mechanics in plain words. Verbs allowed. Slightly technical
allowed at the end, never at the start.

- Example: *"Not every world welcomes settlers. Habitability measures how well a system's
  land supports ordinary life. Settlers fill the best ground first, so growth slows as a
  system fills toward its poorer land. Shown as a percentage of normal population growth."*
- Keyword definitions are glossary entries: written once, reused everywhere the term is
  hoverable. If a definition exists, link it; never write a second definition of the same
  term. (The roadmap's game-term glossary is this register's home.)
- A keyword sentence doesn't take a dash-appended clause — if it needs a dash, it's two
  thoughts and one gets cut. (Contrast the stat register above, where a dashed aside is fine.)

**3. Flavor register** — events, narrative, era text. The only place for extravagant
language, and it earns it: specific, in-world, no mechanics vocabulary at all. A mechanic
consequence attached to an event is stated below the flavor in the stat register, not woven
into the prose.

## The vocabulary

Copy is built from the game's own terms of art — this jargon is sanctioned and *should* be
used consistently: **habitability, pop, population growth, unrest, strike, land, habitable
land, resource, resource slot, worked, yield, provision, rationing, famine, colony, homeworld,
colonise, claim, growth, decay, upkeep, treasury**. One concept, one word, everywhere — if two surfaces
call the same thing a "deposit" and a "slot", one of them is wrong.

The test for every other word: **does it describe the world, or the code?** If a word
describes the implementation — how a value is computed, stored, ordered or cached — it is not
copy, whatever it's called in the source. Numbers follow the same rule: players see
percentages of normal and plain quantities, never raw multipliers on an unstated base, never
internal scores or thresholds. Bands may be named ("rich", "poor"); the cutoffs behind them
are not shown.

**Percentage or multiplier:** a quantity genuinely bounded 0–1 reads as a percentage; a
multiplier that can exceed 1 keeps its own words or its `×`, because a percentage would imply
a ceiling it does not have. (A multiplier shown with `×` still names its base in the label —
"yield ×1.4" is honest only where the surface says what is being multiplied.)

**An allowance never goes inside a displayed number.** Where a mechanic works against a
tolerance (a vacancy allowance, a selling allowance), the figure shown is the true quantity;
the tolerance surfaces through the state it already drives (a health colour, a band), never by
inflating the number. Rationale and the case it comes from: the glossary doc's own rule of the
same name.

## Judging a surface

1. Name the register before writing a word. Component describing a mechanic → stat. Hover on
   a term → keyword. Event/narrative → flavor.
2. Write the shortest string that survives: players absorb enormous amounts of information;
   in stat register every word beyond noun + number must pay rent.
3. Read it as a player who knows the game's terms but nothing about the code. If any word
   needs the source to explain it, rewrite.
4. Reuse before writing: an existing label, keyword definition, or stat format for the same
   concept wins over a new variant.

## Worked conversions (the shape of the fix)

| Was (code-speak) | Is (register) |
|---|---|
| `Extraction ×0.85 contribution weight` | `Yield: 85%` (stat, system-level — extraction pools per-system, so this never shows per body) |
| `Growth ×0.85 — habitability` | `Habitability: 85%` (stat) — the level only; the derived `−15%` is the same number again |
| `size 1.20` | *(deleted — the land and slot numbers already say it)* |
| "the quality fold's frontier index" | *(keyword register, no internals)* "settlers fill the best ground first…" |
