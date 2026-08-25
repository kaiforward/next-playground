# Manufactured-tier founding shortage — measurement working file

Standing question (Kai, 2026-08-25): the manufactured tier (electronics, machinery, medicine,
consumer goods, fuel, polymers) reads ~0.00 median consumer cover at the 16,000-tick horizon, on
main and on `feat/per-body-industry` identically. Why? Candidate causes: recipe-input starvation
of existing factories, logistics/distribution failure, labour/skill gating, or build-planner
behaviour (housing/extraction-first sequencing leaving factory capacity unbuilt).

Context that frames every horizon read: under current timescales the first colony completes
~t=4,128 and 10K is founding era; 16K is still deep founding (the 80% founding mark of a 16K run
is t=8,976). The stale trajectory in `measurement-traps.md` ("recovers to ~0.90 by 16K") predates
the timescale change and must not be read against these runs.

## Claims and falsifiers (committed before instruments run)

**Claim 1 — missing colony capacity, not input-starved homeworlds.** The manufactured-tier floor
at 16K is missing production capacity: tier-1+ output comes almost entirely from the ~20
homeworlds while colony demand grows, and the homeworld factories that exist run at (or near)
their labour-limited capacity — recipe-input gating is not the binding term on them.

> Falsifier: if an in-tick read over electronics- and machinery-producing markets at t≈15,900
> shows the input gate below the labour-fulfilment term on a majority of producing systems (i.e.
> inputs, not labour/capacity, bind), Claim 1 is false and the cause is input starvation
> cascading through the chain.

**Claim 2 — planner choice, not construction scarcity (Kai's sequencing theory, sharpened).**
Colonies under-build tier-1+ because of what the planner proposes and how proposals are gated
(ranking, skill/academy prerequisites, demand thresholds), not because construction resources are
scarce — the pool and treasury would absorb factory projects if proposed.

> Falsifier: if the construction pool is saturated (queue ≫ pool throughput) or construction
> funding was shorted in a material share of founding-era cycles, Claim 2 is false and the
> shortage is a construction-capacity/timescale problem, not an allocation one.

Descriptive (no kill-line): which gates in the build planner's proposal path a young colony must
pass before a tier-1+ building can be proposed at all, with file:line.

## Evidence

(readings land here)
