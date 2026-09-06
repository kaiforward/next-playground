# Logistics gameplay pass — working file

Roadmap row: **[L] Logistics gameplay pass**. Transient; deleted on the PR that finishes the work.

## Decisions so far (2026-09-06)

- **Hauling cost is a funded pool** like build and logistics work: billed to the faction treasury per
  cycle, its own funding slider, one tunable constant. "Money is fuel, not capacity" holds. Who
  *owns* production and movement (faction, pop strata, companies) is a direction question for the
  faction-direction design pass, not this one.
- **Hub/chain depth candidate: a depot** — a staffed, land-billed building whose stock is donor stock
  for logistics, sized per good from measured through-flow (the freight ledger's `routeEdges`), with
  restock ranked below real consumption. The latency case rests on the measurement below.

## Evidence

### Claim 1 — served deficit worlds sit more than a cycle from their donors

Claim: at the equilibrium horizon, a material share of worlds served by directed logistics receive
their inbound goods from donors more than one economic cycle (24 ticks) of scheduled transit away.

Falsifier: if fewer than 10% of served sink worlds have a volume-weighted mean inbound latency above
24 ticks at **both** 10K and 16K (seed 42, 600 systems, per-faction cohorts reported), depots have no
latency case at this galaxy size and the depot direction goes back to brainstorm. 1K is read too
(pre-founding, homeworld-cluster hauls only) but cannot falsify on its own.

### Claim 2 — through-flow concentrates on few systems and is stable

Claim: haul volume that crosses a system as an intermediate (neither source nor sink) concentrates
on a small set of systems, and that set is stable from one window to the next.

Falsifier: if the top 5% of developed systems by through-volume carry under 30% of all
through-volume, **or** the top-10 through-flow set overlaps under 50% between consecutive
10-cycle windows, at 10K and 16K, the through-flow rule is too diffuse for a player to read and the
depot request rule goes back to brainstorm.

### Instrument

Scratch runner `temp/depot-diag.ts`, no processor hook: after every `runWorldTick` it captures new
`world.pendingArrivals` rows (id-deduped) — dispatch tick, arrival tick, route lanes, endpoints,
good, quantity, leg. Validation: outbound rows with arrival in a window must equal that window's
`flowEvents` count (the arrivals stage is `flowEvents`' only writer).
