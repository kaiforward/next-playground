# The Tracker

> **Planned.** The first of the attention layer's two surfaces. The second, the alert bar, is
> specified separately; this doc defines only the Tracker and the rich-card primitive it introduces.

## What it is

The Tracker is a panel down the right-hand side of the map holding **the things the player is keeping
an eye on** — never the things that are wrong. It answers "how is the empire doing" at a glance, and
it is the shortest route back to any system the player cares about.

It holds three lists. **Pinned systems** are chosen by the player, one row each, showing population
and stability. **Building** shows the construction work the pool is actually funding this cycle.
**Colonising** shows every colony currently forming, one row each — the only surface in the game that
says where a colony is coming into being, since the map shows nothing until it exists.

Every row is a shortcut: clicking it flies the map to that system and opens the panel tab where the
thing is happening. Hovering a row opens a card with more detail, and for a pinned system that card
also carries the control to unpin it.

## The rule that decides what belongs here

A Tracker row is a **thing**. It persists whether or not anything is wrong with it — a pinned
homeworld sits in the list while it is perfectly healthy, and that is the point.

An alert-bar row is a **condition**: it exists only while it is true, and fixing it makes it
disappear. Anything shaped like that belongs to the alert bar, not here.

This is why the Tracker is where quiet successes live. With a domain automated, the player still
wants to confirm their worlds are fine without an alert firing to say so, and a list they curate
themselves is how they do it. Nothing in the Tracker ever demands attention.

## Contents

### Pinned systems

Player-curated, unordered by the game (insertion order, so the list does not rearrange itself under
the cursor). Each row carries the system name, its **population** and its **stability** — icon plus
number, so a row stays scannable when there are ten of them.

Those two are chosen deliberately. Stability is the read already proven to work as an attention
signal. Population against its cap is the early warning for crowding, which is one of the two reads
the attention layer exists to provide. A third and fourth metric would turn a scannable list into a
table; anything needing urgency belongs to the alert bar instead.

### Building

The construction work the pool is **actually funding this cycle**, not the whole queue. The
construction pool funds front-first: each project absorbs `min(per-build cap, its remaining work,
pool left)` and the remainder cascades to the next, so a large pool spreads across several parallel
fronts while everything behind them waits at zero. The funded front is exactly the set of projects
that absorbed work — a forecast run of the same funding step the tick uses.

Projects behind the front are summarised as a count, not listed. The whole queue is already visible
per system on the Industry tab, and the reason to show the front here is different: it answers where
the faction's construction capacity is going right now, which is a question about the pool rather
than about any one place.

Both autonomic and player-ordered work appear, undifferentiated.

### Colonising

One row per colony forming, showing the system name and progress. Colonies are few, long-lived and
individually interesting, which is why they get a row each where build levels get a queue.

A colony row is auto-added and removed by the colony completing — it is not pinned or unpinned by
hand. A system may appear both here and in Pinned systems at once; the two lists answer different
questions and are not de-duplicated.

## Placement

The Tracker occupies the right-hand side of the map, sharing one absolute container with the map
controls dock so the two divide the vertical space between them rather than overlapping. The left
side is unavailable — the system and faction drawers are docked there.

The Tracker never blocks the map: it is an overlay the map stays live behind, like the drawers.

Relocating the map-mode controls to a centre-bottom strip would free the whole right edge, but that
is a separate redesign and nothing here depends on it.

## Pinning

A **star toggle** in the system panel header pins and unpins the current system. It uses the header's
existing action slot, alongside the cadence countdown and "Show on Map".

A star rather than a pin glyph: that same header already uses a map-pin icon to mean *locate this
system*, and two pins side by side meaning "find it" and "watch it" would be ambiguous.

The star is the keyboard route for both directions. The unpin control inside a row's card is a
convenience for the mouse, never the only way.

There is no cap on pins.

## Rows and the card

**Every row is a single line.** Nothing in the Tracker grows to two lines unless there is no way to
avoid it — the panel's value is that a dozen rows are scannable at once, and depth belongs in the card
rather than in the list. A row carries a name, at most two figures, and nothing else.

Build and colony rows additionally carry a **2px progress bar flush along the bottom edge of the row**,
full-bleed to the panel's sides, over a faint track. It reads as an underline rather than as a
control, which is what keeps a list of them quiet. Build progress is drawn in the copper accent and
colony progress in the secondary amber — a cosmetic separation only, since the section headings
already distinguish them.

Figures are icon-plus-number, never a bare glyph: population takes a person icon, stability a small
colour swatch beside its value. Stability is never signalled by colour alone.

Clicking a row flies the map to the system and opens the relevant tab: a pinned system and a forming
colony both open Overview (where a colony's founding entry lives), a building row opens Industry
(where its in-flight ghost row lives). This reuses the existing focus mechanism the "Show on Map"
button already drives.

Hovering a row opens a **rich card** carrying a small table of that system's vitals — the same
figures the system panel's vitals grid shows, so there is one definition of how a system is doing
rather than a second. A pinned system's card additionally carries an unpin control.

Everything in a card is a shortcut to something reachable another way, which is what makes the card a
convenience rather than a place information hides.

## The rich-card primitive

The card is a new shared component, built on a **popover** rather than a hover-card. Hover-cards are
mouse-only by design — their content is unreachable by keyboard — and there is no reason to exclude
keyboard users when the accessible primitive is available. The existing plain tooltip stays as it is
for one-line legends; the card is the second, richer tier.

The primitive must:

- **Open on hover** of its trigger, after a short delay, and on click or keyboard focus.
- **Not close while the cursor is travelling toward it.** Closing on pointer-leave alone makes a card
  unreachable in practice. Either a grace area between cursor and card, or the genre's own answer —
  the card follows the cursor until the player holds still, then latches in place.
- **Take focus only when opened by click or keyboard**, never on a hover open, so focus does not jump
  around as the cursor crosses a panel.
- Be **keyboard operable** once open: reachable, escapable, and its controls focusable.

Scope here is one level. Cards whose terms open further cards, pinning a card for comparison, the
concept glossary behind them, and migrating the game's existing tooltips onto this component are all
deliberately left out — a nesting model designed without a real chain of descriptions to design
against would be guessing at a shape.

## Settings

A settings panel controls which sections the Tracker shows — a checkbox per section, unticked meaning
the section is filtered out. Nothing here is non-optional; unlike the alert bar, a Tracker section
carries no urgency, so hiding one loses nothing the player needs.

## Data

Most of what the Tracker shows already exists and is being read on the wrong surface. The faction
construction card already computes the faction's pool, its systems with open builds, and its forming
colonies with progress. The system vitals the rows and cards need are computed for the system panel.

Two things are new:

- **The funded front.** The existing readout gives systems with open projects and a count; it does not
  say which projects the pool is reaching. This is a forecast run of the funding step, keeping the
  projects that absorbed work.
- **The pinned set** — see below.

## World state and saves

Pinned systems are player state and live alongside the automation switches on the player seat, as a
list of system ids. They are therefore **saved and restored with the world**, which makes this a
save-format change rather than a pure-UI one.

A pinned system that no longer exists — abandoned back to unclaimed frontier — is dropped from the
list rather than rendered as a dead row.

## Out of scope

- **Anything condition-shaped.** Overcrowding, unmet demand, strikes, famine and blocked builds are
  the alert bar's, and putting them here would recreate the undifferentiated notification panel the
  attention layer exists to avoid.
- **Ordering pinned systems by severity.** The Tracker does not rank; ranking is the alert bar's
  problem and it is solved there by authored category tiers.
- **Pinning anything but systems.** Formations, markets and factions are all plausible later; systems
  are what the game has and what the two named reads are about.
- **Nesting, pinning and glossary links in the card**, and migrating existing tooltips onto it.
