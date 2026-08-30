# Event Catalog

The three event types that exist, all created by the relations processor — never by random
spawning. See [events.md](./events.md) for the lifecycle these run inside and
[faction-system.md](./faction-system.md#2-inter-faction-relations) for the relation-score
thresholds that create them. For future event content — naturals returning, a strike arc, and the
engine mechanics (branching phases, permanent phases, and the rest) a future arc might need — see
`docs/ROADMAP.md`'s events re-hook line; nothing there is designed yet.

## Border Conflict

Created when a faction pair's relation score drops to the unfriendly band (≤ -25). Targets a
representative border system.

| Phase | Duration (ticks) | Economy modifiers | Player-facing copy when no modifier applies |
|---|---|---|---|
| **Border Tension** | 15-25 | None | "Forces massing at the border" |
| **Skirmish** | 25-35 | Production ×0.9 at the target system | — (real effect, shows the derived summary) |
| **De-escalation** | 10-20 | None | "Forces standing down" |

## Pact Under Negotiation

Created when a faction pair's relation score crosses +75. Single phase, no system or region
target — a political-map signal only.

| Phase | Duration (ticks) | Economy modifiers |
|---|---|---|
| **Negotiation** | 5-10 | None |

If the pair's score holds at or above +60 through the window, the alliance forms. Resolution is
driven by the relations processor's own metadata, not by this phase ending.

## Alliance Dissolving

Created when an allied pair's score drops below +50 while a pact is active. Single phase, no
system or region target.

| Phase | Duration (ticks) | Economy modifiers |
|---|---|---|
| **Dissolving** | 5 (fixed) | None |

After the window the alliance pact is removed by the relations processor.
