# Events System

Three faction-relations arcs are the only events in the galaxy. Nothing spawns randomly: a
border conflict, a pact under negotiation, and an alliance dissolving are created exclusively by
the relations processor from faction-pair scores, never by dice. The machinery that runs event
phases and applies modifiers is general-purpose and stays live underneath — a future
mechanic-owned arc (a strike arc, a naturally-occurring hazard) can reuse it — but today the trio
is everything that exists.

---

## The three event types

| Event | Created by | Phases | System-visible? |
|---|---|---|---|
| `border_conflict` | Relations processor, when a faction pair drops to the unfriendly band (≤ -25) | Border Tension → Skirmish → De-escalation | Yes — targets a representative border system |
| `pact_under_negotiation` | Relations processor, when a pair crosses +75 | Negotiation (single phase) | No — a political-map signal, no system/region target |
| `alliance_dissolved` | Relations processor, when an allied pair drops below +50 | Dissolving (single phase) | No — same, no system/region target |

See [faction-system.md](./faction-system.md#2-inter-faction-relations) for the relations
thresholds and pact lifecycle these events sit inside.

---

## Lifecycle

**Creation.** Only the relations processor creates events, tagging the participant faction pair
via `GameEvent.metadata`. The events processor never rolls dice to spawn one — there is no spawn
path left to roll on.

**Phase progression — `border_conflict` only.** Each tick, the events processor checks whether an
active `border_conflict` has reached the end of its current phase's rolled duration; if so it
advances to the next phase (rolling that phase's duration from its authored range) or, at the end
of De-escalation, expires. `pact_under_negotiation` and `alliance_dissolved` are single-phase and
relations-owned: the events processor skips them entirely, and their lifecycle resolves through
relations' own `metadata.expiresAtTick` — a pact confirms or an alliance dissolves on the
relations processor's own schedule, not through phase transitions here.

**Expiry.** `border_conflict` expires when it has no next phase after De-escalation. The
relations-owned pair events are removed by the relations processor, not by expiry here.

---

## Modifiers

One phase produces a modifier value: `border_conflict`'s **Skirmish** phase multiplies production
by **0.9** at its target system. Border Tension and De-escalation carry no modifiers.

The mechanism itself is unchanged and general: a phase's `ModifierTemplate` entries are anchor
shifts (multiply a good's pricing anchor) or rate multipliers (production/consumption), aggregated
per system by `aggregateModifiers`, capped to `[0.1, 4.0]` (anchor) / `[0.1, 3.0]` (rate), and
consumed by the economy processor the same way any modifier always was
(`WorldMarket.anchorMult` / the production and consumption rate multipliers). With nothing else
producing a value, every field outside the Skirmish chain rests at its neutral default (1).

---

## Player-visible surfaces

- **Faction Diplomacy panel** — the trio's home surface: relation score, stance, active pacts and
  conflicts for a faction pair (see [faction-system.md](./faction-system.md)).
- **Faction Events list** (`components/panels/faction-events.tsx`) — a plain sortable list (by
  time remaining or system name) of whatever events are active galaxy-wide. Since only
  `border_conflict` ever carries a system, the two relations-only pair events don't appear on the
  per-system or galaxy-feed surfaces — they render only in the faction-diplomacy panel.
- **System detail** — the Active Events section on a system's panel shows a `border_conflict`
  active there, renders nothing when empty.

There is no toast, activity-feed, or map-marker surface for events — none exists in the codebase
today.

---

## System interactions

- **Economy**: the Skirmish modifier is the only live economy effect an event produces — see
  [economy.md](./economy.md).
- **Tick engine**: the events processor runs every tick, before economy (see
  [tick-engine.md](../engineering/tick-engine.md)).
- **Faction relations**: the relations processor is the sole producer of all three event types
  (see [faction-system.md](./faction-system.md)); full faction wars are planned (see
  [war-system.md](../../planned/war-system.md)).

## Not in scope

Random spawning, spread to neighbouring systems, one-time stock shocks, and the naturally
occurring hazards (solar storm, asteroid strike, plague) are gone — not paused, not reduced in
frequency. Each returns, if it returns, through its own future spec carrying the mechanic that
makes it preventable or exploitable (see `docs/ROADMAP.md`'s events re-hook line). Until then the
relations trio above is the whole system.
