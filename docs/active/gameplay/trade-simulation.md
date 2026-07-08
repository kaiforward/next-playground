# Open-Edge Topology & Flow Surfaces

Status: **Active** — shipped.

## Overview

The galaxy moves two things along its jump-lane graph — **goods** (directed logistics) and **people** (population migration). Both ride one shared substrate: the **faction-bounded open-edge topology**. Goods movement is entirely directed: a faction hauls its own surplus to its own deficits (see [economy-autonomic-agency.md](./economy-autonomic-agency.md)). There is no passive price-gradient diffusion between markets — a market with no faction haul reaching it simply holds its stock.

Every movement is recorded in a rolling event log (`world.flowEvents`), which backs the Logistics map overlay and the per-system Logistics tab.

---

## Topology — Which Edges Are Open

Movement runs over the **intra-faction jump-lane graph**. An edge is *open* only when its two endpoints belong to the same faction; cross-faction edges are **closed**, so nothing crosses a sovereign border ("factions don't trade at all" until relation-weighted borders open). Two adjacent **independent** systems (no faction on either side) are open to each other under the same rule, forming a permeable pool — but under current world-gen every claimed system belongs to a faction, so this independent path is a **latent capability with no live data**, not an active route today.

**Region lines are not a flow boundary.** A faction's territory is grown by flood-filling the jump-lane graph outward from its homeworld, so it routinely spans several regions, and movement crosses a region border freely whenever both sides share a faction. Regions remain a territory, aggregation, and gateway-rendering concept; the only hard wall is the sovereign (faction) border. This separates the *gameplay* boundary (who may trade) from the *performance* concern (how work is sharded).

The open-edge list (`buildOpenEdges`, `lib/tick/world/trade-flow-topology.ts`) is built each tick from the current systemId → factionId map: each connection is deduped to a single unordered edge, tagged with its fuel cost, and sorted by a stable key so downstream work is deterministic.

## One Topology, Two Movers

- **Directed logistics** (goods) routes over a bounded hop-distance BFS on the same connection graph — the sole goods-mover. Its mechanism and cadence live in [economy-autonomic-agency.md](./economy-autonomic-agency.md).
- **Population migration** consumes the open-edge list directly: population flows toward same-faction neighbours with low unrest and high headroom (`popCap − population`), attenuated by distance (`1 / (1 + distanceDecay · fuelCost)`), conserved (relocated, not created) and capped per tick to prevent ping-pong. See [economy.md](./economy.md) for the full migration model.

Both movers are gated to **developed** systems: migration's open edges are filtered so an edge carries population only when *both* endpoints are developed, and directed logistics only routes between developed participants. Unclaimed and controlled systems are economically inert — no goods, no migration (see [economy-autonomic-agency.md](./economy-autonomic-agency.md)).

Gateways (high fuel-cost connections between faction territory clumps) throttle migration under the attenuation formula — strategic significance without special-case gateway logic.

## The Flow-Event Log

Every directed-logistics haul is appended to a rolling in-memory list on the world (`world.flowEvents`, row type `WorldFlowEvent` in `lib/world/types.ts`), capturing the tick, the directional edge (source and destination), the good, the quantity, and `flowType: "logistics"`. The tick body prunes the log to `FLOW_HISTORY_TICKS` after each run, so its size stays bounded.

A "trade route" is a connected chain of edges moving the same good in the same direction over the window. Routes are not stored — they are computed on demand by walking the flow events, dropping edges below the route-inference floor, and stitching survivors into chains. The event log is the truth; routes are a presentation layer.

---

## Tuneable Constants

Defined in `lib/constants/trade-simulation.ts`:

| Constant | Purpose |
|---|---|
| `FLOW_HISTORY_TICKS` | Rolling window in ticks for retained flow events and route inference. |
| `ROUTE_INFERENCE_FLOOR` | Minimum cumulative flow on an edge before it counts as part of a route. |
| `LOGISTICS_ROUTE_FLOOR` | Minimum cumulative logistics flow on an edge before it renders on the overlay (lower than `ROUTE_INFERENCE_FLOOR` — directed logistics is sparse). |

---

## Player-Facing Surfaces

### Map Overlay

A **Logistics** toggle on the overlay-controls cluster (default off) reveals a Pixi particle layer: edges with cumulative logistics flow above `LOGISTICS_ROUTE_FLOOR` get directional curved convoy arcs tinted by the dominant good's tier, with an arrowhead pointing at the importing system. A tier-colour legend decodes the colour story (raw → green, processed → amber, advanced → cyan); tier colours live in `lib/constants/good-colors.ts`.

### Logistics Tab

The system detail panel's **Logistics** tab pairs two diverging-bar charts over a full-width volume-over-time series — a legibility instrument for the per-system trade picture.

**Internal** (left): production vs consumption for all goods, per-cycle rates, solid bars. **External** (right): imports vs exports over the rolling `FLOW_HISTORY_TICKS` window, cumulative volume; per-row hover tooltips list the top source/destination partner systems. Both columns share a single tier-grouped, net-descending row order so each good aligns across columns. Each column normalises to its own maximum (per-cycle rates vs cumulative volume are incommensurable), so the cross-column comparison is qualitative.

Non-developed systems are inert, so the tab returns the empty shape for them (their services gate on `developed` control).

---

## Implementation Notes

Migration is built on the shared processor architecture — see [processor-architecture.md](../engineering/processor-architecture.md). The live game and the calibration harness run the same pure processor body against the single in-memory backend.
