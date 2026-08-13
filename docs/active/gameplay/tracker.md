# The Tracker

The first of the attention layer's two surfaces. The second, the alert bar, is not built — it is
specified separately and owns everything condition-shaped.

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

Player-curated, in insertion order so the list does not rearrange itself under the cursor. Each row
carries the system name, its **population** as a headcount, and its **stability** — icon plus number,
so a row stays scannable when there are ten of them.

Those two are chosen deliberately. Stability is the read already proven to work as an attention
signal, and population is the magnitude that tells the player which worlds carry their empire.
Population *against its cap* — the early warning for crowding — lives in the row's card rather than
the row, because a second line per row costs more than the ratio is worth here: crowding that
actually bites is the alert bar's job. A third and fourth figure would turn a scannable list into a
table.

There is no cap on the number of pins.

### Building

The construction work the pool is **actually funding this cycle**, not the whole queue. The
construction pool funds front-first: each project absorbs `min(per-build cap, its remaining work,
pool left)` and the remainder cascades to the next, so a large pool spreads across several parallel
fronts while everything behind them waits at zero. The funded front is exactly the set of projects
that absorbed work.

**At most ten rows render**, in queue order. A real faction funds far more than that at once — around
forty is ordinary — and a panel meant to be scanned cannot carry them. Two counts sit beneath the
list and are deliberately **not merged into one figure**, because they mean different things: rows
hidden by the display cap are still being funded right now, while rows behind the front are not being
funded at all. Collapsing them would hide which is true of any given project.

The full queue is visible per system on the Industry tab; a faction-wide view of every open project
does not exist yet.

Both autonomic and player-ordered work appear, undifferentiated.

### Colonising

One row per colony forming, showing the system name and progress. Colonies are few, long-lived and
individually interesting, which is why they get a row each where build levels get a capped list.

A colony row is auto-added and removed by the colony completing — it is not pinned or unpinned by
hand. A system may appear both here and in Pinned systems at once; the two lists answer different
questions and are not de-duplicated.

## Placement

The Tracker sits in the map's **right-edge rail**, the one container it shares with the map controls
dock. The two are real siblings in a flex column: the dock takes its natural height and the Tracker
takes whatever is left, scrolling internally past that point. Overlap is therefore impossible by
layout rather than prevented by a height estimate anyone has to keep in sync. The left side is
unavailable — the system and faction drawers are docked there.

The rail passes pointer events through to the map everywhere except the panels themselves, so empty
space above, below and between them never swallows a click. The Tracker never blocks the map: it is
an overlay the map stays live behind, like the drawers.

## Pinning

A **star toggle** in the system panel header pins and unpins the current system, in the header's
action slot alongside the cadence countdown and "Show on Map".

A star rather than a pin glyph: that same header already uses a map-pin icon to mean *locate this
system*, and two pins side by side meaning "find it" and "watch it" would be ambiguous.

The star is the keyboard route for both directions. The unpin control inside a row's card is a
convenience for the mouse, never the only way. On a world with no player seat the toggle is absent
rather than rendered and inert.

## Rows and the card

**Every row is a single line.** Nothing in the Tracker grows to two lines unless there is no way to
avoid it — the panel's value is that a dozen rows are scannable at once, and depth belongs in the card
rather than in the list. A row carries a name, at most two figures, and nothing else.

Build and colony rows additionally carry a **2px progress bar flush along the bottom edge of the row**,
full-bleed to the panel's sides, over a faint track. It reads as an underline rather than as a
control, which is what keeps a list of them quiet. Build progress is drawn in the copper accent and
colony progress in the secondary amber — a cosmetic separation only, since the section headings
already distinguish them.

That bar also shows **what the coming cycle adds**, as a dimmer extension of the fill in the same
colour — the identical forecast the system construction screen draws, and the exact amount the pool
will fund next cycle rather than an average rate. A project the pool cannot reach this cycle draws no
segment at all, which is how a stalled row is told apart from a slow one at a glance. Near the end the
segment is capped at the work actually remaining, so a bar finishes rather than overflowing.

A build or colony row's one figure is its **cycles remaining**, right-aligned in the same slot a
pinned row spends on population and stability. It stays in the row's ordinary grey even when there is
no forecast at all (an em-dash): the Tracker is a quiet list, and calling out trouble is the alert
bar's job, not a colour on every stalled row.

Figures are icon-plus-number, never a bare glyph: population takes a person icon, stability a small
colour swatch beside its value. Stability is never signalled by colour alone.

Clicking a row flies the map to the system and opens the relevant tab: a pinned system and a forming
colony both open Overview (where a colony's founding entry lives), a building row opens Industry
(where its in-flight ghost row lives). This reuses the same focus mechanism the "Show on Map" button
drives, including its counter, so locating the same system twice still re-centres the map.

Hovering a row opens a **rich card**, and **a card describes its row's subject**. A pinned row's
subject is a system, so its card carries that system's vitals — the same figures the system panel's
vitals grid shows, so there is one definition of how a system is doing rather than a second — plus
the unpin control. A build or colony row's subject is a *project*, so its card carries the project:
what is being built, its progress and its ETA. Vitals are a hover away on the system panel and do not
belong in a card about a project.

Everything in a card is a shortcut to something reachable another way, which is what makes the card a
convenience rather than a place information hides.

## The rich-card primitive

The card is a shared component built on a **popover** rather than a hover-card. Hover-cards are
mouse-only by design — their content is unreachable by keyboard — and there is no reason to exclude
keyboard users when the accessible primitive is available. The plain tooltip remains the first tier
for one-line legends; the card is the second, richer tier.

It opens on hover after a delay, on keyboard focus, and on click. It does **not** take focus on a
hover open, only on a click or keyboard open, so focus does not jump around as the cursor crosses a
panel. It stays open while the cursor travels from trigger to card, closes on Escape returning focus
to the trigger, and only one card is open at a time.

A consumer can **opt out of click-to-open** where the trigger's click already means something else.
The Tracker does exactly that: a row's click navigates, so the card is reached by hover or keyboard
only.

Scope is one level. Cards whose terms open further cards, pinning a card for comparison, the concept
glossary behind them, and migrating the game's existing tooltips onto this component are all
deliberately out — a nesting model designed without a real chain of descriptions to design against
would be guessing at a shape.

## Settings

A **settings panel opens to the left of the Tracker**, inside the same rail, from a control in the
Tracker's own header — a sibling panel rather than a floating menu. It carries one toggle per
section. Hiding a section removes it entirely, heading and counts included; hiding all three still
leaves the Tracker's header present so the settings stay reachable.

Section visibility persists in the browser, not in the save: it is a view preference rather than game
state. A malformed stored value falls back to all sections visible. Whether the settings panel itself
is open is ephemeral and is not persisted.

Nothing here is non-optional. Unlike the alert bar, a Tracker section carries no urgency, so hiding
one loses nothing the player needs.

## World state and saves

Pinned systems are player state and live alongside the automation switches on the player seat, as a
list of system ids — so they are **saved and restored with the world**. Nothing in the tick reads
them: no processor, adapter or tick body touches the pinned set.

A pinned system that no longer exists — abandoned back to unclaimed frontier — is filtered out on
read rather than pruned on write, which is why abandonment needs no tick write. A pinned system
belonging to another faction is still shown: a pin is a bookmark, not an ownership claim.

## Out of scope

- **Anything condition-shaped.** Overcrowding, unmet demand, strikes, famine and blocked builds are
  the alert bar's, and putting them here would recreate the undifferentiated notification panel the
  attention layer exists to avoid.
- **Ordering pinned systems by severity.** The Tracker does not rank; ranking is the alert bar's
  problem and it is solved there by authored category tiers.
- **Pinning anything but systems.** Formations, markets and factions are all plausible later; systems
  are what the game has and what the two named reads are about.
- **Nesting, pinning and glossary links in the card**, and migrating existing tooltips onto it.
