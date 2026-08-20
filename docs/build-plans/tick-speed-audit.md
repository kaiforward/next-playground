# Tick-speed acceptable-maximum audit — working file

**Outcome (2026-08-20): Claim B CONFIRMED, Claim C FALSE in its stated range, Claim A DISMISSED**
(evidence below). The browser worker's collapse is host-side frame derivation + autosave, not the
engine. Claim A is dismissed by owner decision (2026-08-20): B's mechanism (content-scaled host
cost) plausibly covers the 600-system 4-vs-75 anecdote, the anecdote's conditions were unrecorded,
and no 600-scale reading was spent on it — dismissed, not ruled out. Claim C measured (C1 below):
the Node engine sustains ~10.5 TPS at 10,000 systems at the 10,000-tick horizon — above the 5 TPS
reference, so no ceiling inside the current presets — but the crossing extrapolates to ~19-20K
systems, inside the owner's 10-20K aspiration band, at the CHEAPEST era (founding, ~490 developed).
The `/brainstorm` ran 2026-08-20; the chosen direction and committed falsifier are in `## Idea`
at the end of this file (roadmap row "Frame architecture" carries the merge-blocking decision).
Instruments were
reverted per the measure rule; temp/tick-timing-diag.ts and temp/tps-scale-diag.ts (gitignored)
survive, and the `?tickdiag` worker instrument can be re-created from this file's description +
git history of the session if the spec pass wants live readings again.

Roadmap row: Tick performance > "[S] Tick-speed acceptable-maximum audit". This file starts at the
row's `/measure` step. Two questions drive it: where tick time actually goes as the galaxy grows,
and why the browser worker's max-speed TPS varied wildly between two same-size galaxies (owner
observed ~4 TPS on one galaxy post-expansion vs ~75 TPS on another at a similar date, both 600
systems; the Node harness has never shown such a spread).

## Claims and falsifiers (committed before any instrument runs)

### Claim A — the variance is simulation load, tracked by the developed cohort

Max-speed TPS is governed by the developed-system count (the cohort every cycle-start processor
resolves), not by total system count or by the host: two same-size galaxies at the same date differ
in TPS because their developed cohorts (and the population/industry mass on them) differ.

**Falsifier A:** if, at matched developed-system counts on the same host, measured TPS still
differs by more than 2× between galaxies — or if the two anecdote-like endpoints (a sprawling
developed cohort vs a small one at the same date) cannot reproduce at least a 5× TPS spread — the
claim is false: the variance lives in the host (frame serialisation, autosave, timer throttling),
not the simulation, and the fix hunt moves to the worker plumbing instead of the processors.

### Claim B — browser overhead is non-tick host work

The browser worker's TPS deficit against the Node harness on the same world is dominated by
non-tick host work: building and structured-cloning the full state frame every throttle window
(`buildStateFrame` sends full frames — `since` is ignored by design), plus the 60 s autosave
serialising the whole world on the worker thread.

**Falsifier B:** if frame-build + postMessage + autosave together account for under 10% of worker
busy time at max speed on a heavy (late-game, large developed cohort) save, the claim is false —
the browser/Node gap lies inside the tick itself (engine/JIT differences) and frame plumbing is
not the lever.

### Claim C — the acceptable maximum (the roadmap deliverable)

Sustained max-speed TPS at equilibrium falls below the fast-mode reference rate (5 ticks/s)
somewhere between the default 600 systems and the 10K upper preset in the Node harness — i.e.
there is a system-count/developed-mass ceiling worth knowing before any content pushes players
toward bigger galaxies.

**Falsifier C:** if the harness sustains ≥5 TPS at equilibrium even at 10K systems, the claim is
false and the audit's deliverable inverts: the ceiling is comfortably above every current preset
and the tick-performance rows lose urgency (recorded as such, with the curve).

## Owner observations (anecdote, pre-instrument — conditions unrecorded)

- ~4 TPS vs ~75 TPS on two 600-system galaxies at similar dates (browser, max speed).
- ~0 TPS on a 20,000-system universe (browser). The Node calibration projects ~19 TPS at 10K
  equilibrium — an order-of-magnitude host gap, prioritising Claim B ahead of the big Node runs
  (owner decision 2026-08-20). Target scale note: the owner's aspiration is 10-20K systems
  (EU5 ≈ 22K locations).

## Instruments (chosen per claim; validated before reading)

- **Per-processor tick timing, inside the tick body** — a scratch diagnostic wrapping each
  processor call in `runWorldTick` (temp/ runner; the lib/ patch reverted same-turn per the skill
  rule). Distinguishes cycle-start ticks from ordinary ticks; records developed-system count per
  reading. Validation: the sum of per-processor times must match the whole-tick time the harness
  already reports (`elapsedMs`).
- **TPS-vs-scale curve (Node)** — timed harness runs at multiple system counts, both horizons,
  cohorted by developed count (Claim C). Duration estimated from the tool's early output before
  committing to the big runs.
- **Browser worker readings (Claims A/B)** — the real game under `npx vite dev` in Chrome:
  max-speed TPS from the pacing frames (`achievedTps`), plus worker-side timing of frame build +
  post + autosave (temporary instrumentation, reverted). Two saves engineered to differ in
  developed cohort at the same date reproduce the anecdote's endpoints.

Evidence lands below in the six-field frame with raw output attached.

## Evidence

### B1 — browser worker at 20,000 systems (real Chrome, live game, `?tickdiag` instrument)

Conditions: `npx vite dev`, fresh 20,000-system galaxy (seed 42, 30 developed homeworlds, founding
era t≈0-14), max speed, instrument relayed from the worker through the page console. Node-side
comparator: the per-processor calibration on this branch (same commit).

```
Meaning:    The engine is innocent and the host is guilty: at 20K systems a tick costs ~0.1s but
            BUILDING ONE STATE FRAME costs ~8.7s and the 60s autosave costs ~47s — the worker
            spends ~87-99% of its time on frame/save work and ~1% ticking. Max-speed TPS ≈ 0.1.
Claim:      Claim B (browser overhead is non-tick host work).
Number:     buildStateFrame 8,521-8,829 ms per push (mean of every observed window); host.post
            107-148 ms; tick 96-131 ms typical (one window's mean 1,242 ms with a 2,353 ms max —
            an events-heavy tick, 77 events); share% tick/frame/idle = 1.1/98.8/0.1 (window 1),
            12.4/86.6/1.0 (window 2), 1.1/98.7/0.1 (window 3); achieved TPS 0.10-0.11; autosave
            46,787 ms, error=none. Frame content: per-id slices for ALL 15,232 non-empty system
            entries across 8 per-system families (~120K derived objects per push), rebuilt from
            scratch at most 4×/s regardless of change.
Horizon:    founding era only (t≤14) — the CHEAPEST possible content state: 30 developed systems.
            Equilibrium can only be worse (more developed content per slice). No second horizon
            needed for the claim's direction; the falsifier threshold (10%) is exceeded by ~9×
            at the era most favourable to the null.
Cohort:     one 20K-system galaxy, seed 42, 30 developed; single Chrome tab, dev build of the
            client (Vite dev — production build would change absolute numbers, not the 98%/1%
            split's order of magnitude, but this is unmeasured).
Licenses:   Supports: Claim B CONFIRMED at 20K — the falsifier (host work <10% of busy time)
            fails by two orders of magnitude; the owner's "~0 TPS at 20K" is fully explained
            without any engine involvement (tick ≈ 100 ms matches the Node extrapolation).
            Supports: the fix direction the spec already gated on the booked dirty-set roadmap
            row — frames must stop rebuilding every per-id slice for every system every push;
            autosave must leave the hot path. Does NOT support: attributing the 600-system
            4-vs-75 TPS variance to the same mechanism without a 600-scale reading (frame cost
            at 600 is ~1/25th of this by system count alone) — Claim A remains open. Does NOT
            support: any equilibrium-era number (unmeasured in-browser).
```

Raw summary lines (page-relayed, verbatim):

```
[tickdiag] summary tps=0.11 ticks=2 cycleStarts=0 tick=4 developed=30 lastTickMs=65.60 tickMs(mean/max)=96.05/126.50 buildMs(mean/max)=8651.40/8829.00 postMs(mean/max)=128.30/148.00 pushes=2 share%(tick/frame/idle)=1.1/98.8/0.1 slices={"atlas":6,"universe":4,...,"ownership":15232,"stability":15232,"population":15232,"development":15232,...,"systemVitals":15232,"systemPopulation":15232,"systemIndustry":15232,"systemLogistics":15232,"systemConstruction":15232,"systemBuildOptions":15232,"systemSubstrate":15232,"market":15232,...}
[tickdiag] summary tps=0.10 ticks=2 cycleStarts=0 tick=6 developed=30 lastTickMs=131.00 tickMs(mean/max)=1242.05/2353.10 buildMs(mean/max)=8521.05/8631.80 postMs(mean/max)=124.60/138.40 pushes=2 share%(tick/frame/idle)=12.4/86.6/1.0 slices={...,"events":77,...}
[tickdiag] summary tps=0.11 ticks=1 cycleStarts=0 tick=7 developed=30 lastTickMs=103.00 tickMs(mean/max)=103.00/103.00 buildMs(mean/max)=8756.70/8756.70 postMs(mean/max)=107.10/107.10 pushes=1 share%(tick/frame/idle)=1.1/98.7/0.1 slices={...}
[tickdiag] autosave ms=46787.3 error=none
```

Side observations with receipts (not claims — candidates for the follow-up reading):
- The main thread receives and merges those ~120K-object frames (`replaceEqualDeep` over 15,232-key
  records ×8 families per push) — main-thread stall cost unmeasured; a mid-run page reload occurred
  once (cause unattributed; the dev-reload restore recovered the galaxy correctly, live).
- `buildStateFrame` cost is content-driven, so it plausibly also explains the 600-system 4-vs-75
  variance (two galaxies differing in developed mass → differing frame+autosave cost) — that is
  Claim A's follow-up reading at 600 scale, not yet taken.

### C1 — TPS-vs-scale curve (Node, sustained at the 10,000-tick horizon)

Conditions: `temp/tps-scale-diag.ts` (no lib/ patch — times whole `runWorldTick` calls), seed 42,
10,000-tick warmup then a 500-tick timed window per scale; 600-system point recomputed from the
calibration run's raw window (same seed, same horizon, same window length). Sequential runs, idle
machine.

```
Meaning:    The Node engine has no TPS ceiling inside the current presets — but the 5 TPS
            reference rate is crossed around ~19-20K systems, inside the owner's 10-20K
            aspiration band, and that is at the cheapest era the game has.
Claim:      Claim C (sustained TPS falls below 5 somewhere between 600 and 10K systems).
Number:     Sustained TPS at t=10,000-10,500: 600 systems 118.8 (developed 315); 2,000 systems
            56.4 (439); 5,000 systems 22.7 (502); 10,000 systems 10.5 (493). 10K detail:
            ordinary-tick median 35.0 ms / p95 293 ms, cycle-start median 340 ms / p95 563 ms.
            Last-segment log-log slope (5K->10K) ~ -1.1; 5 TPS crossing extrapolates to ~19-20K
            systems (extrapolated, unmeasured). The earlier two-point fit's ~19.5 TPS at 10K
            was ~2x optimistic vs the measured 10.5.
Horizon:    10,000-tick window end only (founding era ~year 7 — first colony ~t=4,128). This is
            the era MOST favourable to the claim being false: the developed cohort is still
            small (~490 of 10K) and barely grows with scale here, so per-tick cost at this
            horizon is dominated by total-system-scaled machinery. True late-game equilibrium
            (bigger developed mass) can only be slower.
Cohort:     one galaxy per scale, seed 42; developed counts as listed (note they are FLAT across
            2K/5K/10K — settlement pace, not map size, sets the cohort at this date), so the
            curve isolates the total-system scaling term the calibration flagged (join/merge
            ~46%, directed-build full-list scan).
Licenses:   Supports: Claim C FALSE in its stated range — 10K sustains 10.5 >= 5 TPS; no preset
            hits the ceiling. Supports: re-prioritising engine tick work only when content
            pushes past ~10K systems or a later era fattens the developed cohort; at 20K the
            engine alone is marginal (~5 TPS extrapolated) even before host work. Does NOT
            support: any claim about late-game equilibrium TPS (unmeasured era); treating
            ~19-20K as a measured ceiling (extrapolated from the last segment).
```

Raw summary lines (verbatim, from temp/tps-scale-claimC-out.txt; per-tick rows in
temp/tps-scale-claimC-s{2000,5000,10000}-t10500.jsonl):

```
s2000:  SUSTAINED: 500 ticks in 8.87s -> 56.39 tps   ORDINARY median 9.505  CYCLE median 166.990   developed=439
s5000:  SUSTAINED: 500 ticks in 22.04s -> 22.69 tps  ORDINARY median 20.405 CYCLE median 276.598   developed=502
s10000: SUSTAINED: 500 ticks in 47.68s -> 10.49 tps  ORDINARY median 35.041 CYCLE median 340.069   developed=493
s600 (recomputed from tick-timing-s600e10000-s600-t10500.jsonl): 500 ticks, 4210 ms -> 118.76 tps, developed=315
```

### Node calibration (per-processor, both eras at 600; startup at 2000) — summary

Instrumented `runWorldTick` (tagged patch, validated: byte-identical world evolution, residual
42-47% = join/merge machinery scaling with total systems). 600 systems: ordinary tick median
1.71 ms (startup) / 4.25 ms (equilibrium); cycle-start 21.79 / 101.62 ms; directed-build is the
largest cycle-start line everywhere (scans the full system list). Extrapolated equilibrium TPS:
~56 at 2000 systems, ~19.5 at 10K (two-point exponent fit — unmeasured, the parked big runs
would confirm). Raw JSONL in temp/tick-timing-*.jsonl (gitignored).

## Idea — pull-based frame architecture (brainstorm 2026-08-20)

### Problem

Every state push rebuilds panel-level detail for every system in the galaxy
(`buildStateFrame`, `lib/runtime/snapshot.ts:210-289` — eight per-id families × every system,
~120K derived objects at 20K), even though the UI shows the map plus at most one system panel and
one faction panel at a time. At 20K systems that is ~8.7 s per push against a ~0.1 s tick (B1
above), and the main thread then merges the same ~120K objects per frame. The 60 s autosave
(~47 s at 20K) shares the hot path and is folded into this feature as its own sub-decision
(direction not yet chosen — see Premises).

### Chosen direction (owner call, 2026-08-20)

**Interest subscriptions with a read command as a first-class part of it** ("B with A inside"):

- Pushes carry the **coarse set** every tick-window as today: pacing, the flat full-galaxy map
  layers (ownership, stability, population, development, migration, provision, universe/atlas,
  visibility), events, alerts, tracker, playerSettings, faction summaries/relations, and the
  aggregate slices — everything the map and the attention layer need with the whole galaxy
  visible at 20K zoom-out (owner watch-item; wars/battles/ship units will widen this set later).
- The UI declares an **interest set** (the ids of the panels currently open); each push carries
  per-id detail for only those ids. Hooks stay synchronous store selectors; the command-result →
  state-frame ordering the command overlay depends on (`client/worker/game-worker.ts:589-594`)
  is preserved.
- A **read command** over the existing command channel serves one-shot or rarely-open reads —
  a worker round-trip is a postMessage pair, not HTTP + route rendering (owner: the old
  TanStack/Next slowness was plausibly sub-page routing, not the async-read concept).
- Which slice rides which mechanism (pushed-coarse vs subscribed vs read-command — e.g.
  `marketComparison`, `colonyEligibility`) is a per-slice call for the spec, not fixed here.

### Killed alternatives

- **Pure request/response pull (A alone)** — reintroduces per-panel loading states and
  refetch-on-tick machinery for always-on surfaces, violating the synchronous-store-selector
  convention the migration just established. Kept *inside* B for one-shot reads instead.
- **Incremental/dirty frames (C)** — no dirty signal exists: the tick adapters hand back fresh
  rows whether or not anything changed (`lib/runtime/snapshot.ts:17-24`), and building one is
  the separate "Markets need a real dirty/ownership model" roadmap row, which this feature
  explicitly does not gate on. Dirty-sets only where a processor makes them free.

### Premises

**Checkable** (become `/measure` claims; fixture = 20K-system galaxy, seed 42, founding era —
the roadmap row's acceptance fixture — measured in the real browser worker or a Node driver of
the same call path):

1. **Single-id detail derivation is cheap.** Deriving one system's full panel detail (vitals,
   population, industry, logistics, construction, buildOptions, substrate, market) for a single
   id at 20K systems costs ≤ ~10 ms per call. Risk: the read services were built for batch
   derivation and may do galaxy-scale work per call (e.g. `getMarketComparison` scans every
   system per good; trade-flow/logistics may derive network-wide intermediates).
2. **The coarse pushed set is cheap.** A per-slice cost breakdown of `buildStateFrame` at 20K
   shows the per-system detail families dominate, and the coarse set (map layers + attention +
   aggregates as listed above) builds in ≤ ~250 ms per push.
3. **Autosave cost split.** How the ~47 s autosave divides between `JSON.stringify` and the
   IndexedDB write, and what a structured-clone handoff of the `World` to a second worker costs
   at 20K — the numbers that pick the autosave sub-direction.

**Definitional** (owner decisions, no measurement):

- Client reads stay synchronous store selectors; no loading/error checks return (AGENTS.md
  convention; reaffirmed in this brainstorm's B-over-A call).
- Alerts and tracker remain worker-derived aggregate slices in the pushed coarse set
  (`lib/runtime/snapshot.ts:259-260`) — they never widen the interest set.
- The interest set is the open panels, not the player's controlled systems.
- 20K systems is the acceptance fixture (owner aspiration band 10-20K).

**Hypothesis** (carried forward, labelled):

- Main-thread merge cost (`replaceEqualDeep` over ~120K objects per frame) shrinks
  proportionally once frames shrink — unmeasured.
- The 600-system 4-vs-75 TPS anecdote is this same mechanism (Claim A was dismissed, not ruled
  out; no 600-scale reading exists).

### Terminal falsifier

**If deriving one system's full panel detail at the 20K fixture measures ≥ ~500 ms per call —
within an order of magnitude of building the full frame — and cannot be brought under ~10 ms by
scoping the existing read services (i.e. their galaxy-scale intermediates are irreducible per
call), the direction is dead:** subscribed detail would cost like full frames the moment a few
panels are open, and the fix must instead be incremental push gated on the markets
dirty/ownership model row. Units: ms per single-id detail derivation; fixture: 20K systems,
seed 42, founding era.
