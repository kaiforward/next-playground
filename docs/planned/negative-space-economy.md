# The Negative-Space Economy

**Design principle + an architecture decision that follows from it.** The uninhabitable, under-supplied, inefficient regions of the universe are not defects to tune away — they are the **negative space**: the design surface that faction agency and specialised infrastructure are built to fill. This doc states the principle, what it forbids, and the trade-flow-vs-logistics decision it implies. It sits above the [economy-simulation vision](./economy-simulation-vision.md) as a north-star constraint on all economy work. Companion north-star: emergent realism from physical primitives.

---

## The principle

The economy's resting state is a **deliberately un-optimised baseline.** Most of the galaxy is poorly exploited — barren rock no one lives on, worlds that can't feed themselves, production that swallows more labour than a place can house. That is intentional, because **the optimisers don't exist yet.** Directed logistics, off-habitable housing, low-population production, treasury-funded build-out — these are the planned mechanics, and each one earns its place by *working the slack the baseline leaves*.

> Build a universe that isn't taken advantage of very well — *because the tools to take advantage of it don't exist yet.* The slack is the game.

The decline an un-agentic galaxy shows over time (see the audit below) is not a system failing. It is a universe sitting at its un-worked resting state, waiting for agents that can act on the inefficiency. When agency ships, factions (and players competing with them) work the negative space, and *that work is a large part of the gameplay.*

### The forward direction

The negative space may **grow** deliberately. Candidate future moves to raise challenge: make the base substrate *less* inhabitable, shrink factions, and leave more dead, unowned space belonging to no faction. The point is not a comfortable balanced galaxy — it is a harsh, sparsely-viable one with a stable floor and a large improvable frontier.

---

## What this forbids (the tuning guardrail)

The standing temptation is to "fix" a baseline inefficiency by tuning a base mechanic until it works well. **Don't.** If the base mechanics work too well on their own, the gameplay levers have nothing left to improve, and the reason to build a transport lane / arcology / specialised factory evaporates.

Distinguish two kinds of change — only the first is allowed at the base layer:

- **Remove artifact / noise — OK.** e.g. the seed staffing-self-consistency fix: it deleted *phantom* industry (buildings that produced nothing and were already decaying away) and left the freed deposit/general space as honest unbuilt headroom. It made the baseline *honest*, not *efficient* — it created design space rather than consuming it.
- **Make the base efficient — NOT OK.** e.g. tuning market trade-flow to reliably feed the under-supplied middle. That does the factions' future job for them and deletes the negative space.

Calibration of base mechanics targets only a healthy *shape* — no NaN / runaway / pinning, a stable self-sufficient floor, and a large improvable middle — never "make every system thrive." (This is the coarse-health-bar calibration stance, applied to the baseline.)

---

## The design-space inventory

Each baseline inefficiency the audit surfaced maps 1:1 to a planned lever. The 1:1-ness is the tell that these are features, not bugs:

| Baseline inefficiency (measured) | The mechanic that works it |
|---|---|
| ~58% "suppliable" middle — can't feed itself locally, starved by distance-attenuation | Directed faction logistics + special transport lanes + logistics infrastructure |
| ~35% of worlds have zero arable / barren `popCap`-0 rock | Specialised off-habitable (orbital / artificial) housing |
| Every producer needs ~25 locally-housed workers | Specialised low-population production |
| One-way decay, no rebuild (post-SP3.5) | Treasury-funded build / demolish agency (SP5) |

---

## Architecture decision: directed logistics is a separate flow, not a re-tuning of trade-flow

**Trade-flow stays "emergent market trade" and stays deliberately leaky. Intentional faction logistics is a distinct, additive flow — not the same mechanism re-tuned.**

| | Market trade-flow (today) | Directed logistics (SP5) |
|---|---|---|
| Driver | local price gradient | faction need / strategy |
| Intent | none — the invisible hand | a faction *decides* to move a resource |
| Economics | profit-seeking, self-financing; can't move against the gradient | may ship at a loss (subsidised); moves anti-gradient | 
| Funding | none | treasury |
| Legibility | ambient, invisible | legible — the player sees a faction acting (Elite-style orders for v1; visible convoys later) |

Why separate:

- **Different actor, different driver** — folding them hides the distinction the player needs to reason about ("is this the market, or a faction acting?").
- **It protects the negative space** — if logistics is a layer factions *invest in*, the base diffusion stays leaky and overcoming that leak (lanes, infrastructure) is the gameplay. Conflating them invites the forbidden "tune it up" move.
- **It matches the existing pattern** — migration already rides the trade-flow *topology* as a parallel flow distinct from goods. Directed logistics is the **third flow on the shared edge graph + work-budget sweep**: one topology, three flow semantics (market goods / migration / directed logistics).
- **The coupling is benign** — when logistics dumps food into a deficit system its price drops, which *naturally* tapers the market inflow. No double-supply; they compose.

Net: trade-flow keeps meaning *"the trades that would happen at these prices."* Logistics means *"what a faction chooses to move regardless of price."* Two clean concepts instead of one muddy one.

A throughput experiment on trade-flow (push food harder, measure how much of the middle survives) is therefore only ever a **measuring instrument** to *size* the design space — the tuning is thrown away, never shipped. Not urgent, and gated behind this framing decision.

---

## Grounding evidence — the 2026-06-24 viability audit

Run against the live DB and a fresh in-memory new-seed universe at mature `popCap` (the two agree closely — viability is deposit-and-topology driven, so it's seed-robust). Scripts: `scripts/diagnose-viability.ts` (live DB), `scripts/diagnose-viability-gen.ts` (new seed), `scripts/diagnose-labour.ts`, `scripts/verify-staffing-gen.ts`.

- **It's distribution, not scarcity** — 19/20 factions run a food *and* water surplus (1.6–3.1×). The galaxy makes plenty of food; it just doesn't reach everywhere.
- **Structural viability classes (new seed, mature):** ~41% **self-sufficient** (the durable core — survives with zero agency, the equilibrium anchor) · ~58% **suppliable** (deficit, but a same-faction food surplus sits within ~2 hops — lives or dies on whether trade *delivers*) · ~1.2% **stranded** (no local food, none reachable — doomed by geography, and that's fine).
- **The 58% middle is a throughput problem, not a scarcity one** — food is "2 hops away" but market diffusion is distance/fuel-attenuated, so a gateway hop delivers a trickle. This is exactly the gap directed logistics is for. *(Build agency can't save it — these worlds have no arable deposits to build food on; the food must be **moved**.)*
- **Decay-only is a one-way ratchet that progressively hollows** — over 3000 ticks: pop −11.5% (and trending, not plateauing), striking systems 11 → 112, infra decayed 4.7% → 25.4%. Not a uniform death — a spreading tail-spiral of the suppliable middle, never recovered because nothing rebuilds.
- **Seed staffing-self-consistency fix (shipped this session, working tree):** industry is now seeded only up to what local population can staff (`labourDemand ≤ popCap`), so a fresh system is fully staffable as it matures instead of carrying phantom idle capacity the decay loop immediately liquidates. ~60% fewer buildings seeded (28.3K → 11.1K at sim scale); mean staffing ceiling 0.24 → 1.000; 11 zero-habitable worlds correctly seed no industry. Population decline and unrest both *improved* (sim −2.9% → −1.3% at 500 ticks). The freed space is headroom for SP5 build-out.

---

## Sequencing implication

The audit resequences the [vision §13](./economy-simulation-vision.md#13-sub-project-decomposition) order. See that section's dated callout for the canonical statement; in brief:

1. ✅ **Seed staffing-self-consistency fix** (done this session).
2. **SP5 autonomic-light agency, brought forward — logistics-first, build-second.** The at-risk middle needs food *moved*, not industry rebuilt; build agency is the durable core's recovery mechanism. Self-funded, slow, no treasury — SP5's designed first slice, not throwaway.
3. **SP4 "Population ← economic viability."** Safe only once a recovery counterforce exists — on a decay-only base it just sharpens the hollowing.
4. **Full faction agency** (treasury, build planner, directed-logistics v2, military ceiling) + inherited rebellion / relation-weighted borders.
5. **Events → physical perturbations.** Last — decoration on a base that now heals; perturbing a world that can't recover reads as permanent damage, not weather.
6. **War capstone.**
