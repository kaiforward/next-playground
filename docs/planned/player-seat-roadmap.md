# Player Seat Roadmap — The Purse & The Alert Feed

> **Planned.** The remaining unbuilt slices of the grand-strategy pivot's player-seat phase
> ([grand-strategy-vision.md](./grand-strategy-vision.md) §8 Phase 3), after the seat (identity/entry)
> and control + construction actualisation shipped — see
> [player-seat.md](../active/gameplay/player-seat.md). Both slices below build on structures that
> already exist rather than inventing their own roster first.

---

## The purse (faction money)

EU5-shaped: buildings carry a monetary dimension attached to structures that already exist, rather than
needing a new building roster invented first.

- **Tax yield + maintenance cost per building**, feeding a per-faction **treasury**.
- **Budget bands** replace today's free, population-funded construction pool — construction and
  logistics draw from budgeted allocations instead of an uncapped physical throughput number.
- **Tax policy trades revenue against population happiness/unrest** — a real lever the player (and the
  AI, on the same mechanism) tunes, not a slider with no consequence.

This is the natural next home for territorial-expansion costs currently deferred as free: claiming
currently carries no throughput cost (`faction-system.md` §Territorial Expansion), and is a candidate for
pricing once a treasury exists to price it against.

---

## Alert feed (faction situation log)

The faction's per-asset alert feed and situation log — the Paradox alert-strip model
(`grand-strategy-vision.md` calls this out as "Notifications / Captain's Log" in its systems-mapping
table). Comes once there is enough autonomic + player activity happening across a faction's territory
that surfacing "where to look" earns its own surface, rather than requiring the player to tour every
system.

---

## Sequencing

Both are designed but not planned in implementation detail — each gets its own design pass (spec →
build plan) when picked up, following the same per-slice process the seat and control slices used.
