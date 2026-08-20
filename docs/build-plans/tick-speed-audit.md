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

## Idea evidence (measured 2026-08-20, after the falsifier commit)

Instruments: `temp/frame-cost-diag.ts` (claims 1+2) and `temp/autosave-split-diag.ts` (claim 3),
both gitignored Node scratch runners driving the REAL call paths (`generateWorld` 20K seed 42,
10 ticks committed via `setWorld`, then the same service calls `buildStateFrame` makes). No `lib/`
patch was needed — `git status` clean throughout. Validation: (a) the per-slice sum (~3.5 s,
round 2) agrees with the whole `buildStateFrame` best run (4.13 s) within ~15% (residual = record
assembly + first-run JIT); (b) the Node full-frame time (4.1-7.5 s) is the same order as B1's
browser mean (~8.65 s), so Node readings transfer.

### I1 — single-id panel-detail derivation (Idea premise 1)

```
Meaning:    Deriving one system's complete panel detail is sub-millisecond even on the priciest
            cohort — the read services do NOT do irreducible galaxy-scale work per call, so
            interest-subscribed detail is affordable at any plausible open-panel count.
Claim:      Single-id full panel detail (8 families) at 20K systems costs <= ~10 ms per call.
Number:     Developed cohort (all 29): bundle mean 0.955 ms, median 0.782, max 4.674 (max is
            first-call JIT on industry: 4.077). Undeveloped sample (100, stride-picked): bundle
            mean 0.212 ms, median 0.207, max 0.484. Worst single family (developed): industry
            mean 0.464 ms; substrate mean 0.143 ms.
Horizon:    founding era (t=10) only — matches the B1 fixture and the committed falsifier.
            Per-id cost grows with per-system CONTENT (a late-game developed system is richer),
            not with total systems; equilibrium unmeasured.
Cohort:     20K galaxy (15,232 non-empty systems), seed 42; developed (29) and undeveloped (100
            sampled) reported separately.
Licenses:   Supports: premise 1 CONFIRMED — two orders of magnitude under the 10 ms bar, three
            under the 500 ms terminal falsifier; the pull direction survives. Supports: B's
            per-push detail cost for a handful of subscribed ids is ~1-5 ms. Does NOT support:
            an equilibrium-era per-id number, or extrapolating the undeveloped cohort's cost to
            developed late-game systems.
```

### I2 — per-slice buildStateFrame breakdown / coarse-set cost (Idea premise 2)

```
Meaning:    The eight per-system detail families ARE the frame cost; everything the map and
            attention layer need (the coarse set) is essentially free even at 20K — the split
            the chosen direction assumes is exactly how the cost actually falls.
Number:     Full buildStateFrame: 7546 / 4566 / 4133 ms (3 runs, first includes JIT). Detail
            families (all 15,232 systems, round 2): substrate 1651, logistics 518, population
            387, vitals 216, construction 180, industry 175, market 171, buildOptions 162 —
            sum ~3460 ms (~99.5% of the per-slice total). Coarse set sum ~17 ms: factionAggregates
            10.4, universe 1.0-9.0, atlas 1.5, factions 1.1, development 0.9, tradeFlow 0.5-0.8,
            everything else <=0.2 each (alerts/tracker ~0.00 — see Licenses). marketComparison
            (all 26 goods) 0.2-0.5 ms; colonyEligibility ~0 (0 controlled systems at t=10);
            constructionStalls 2.3-2.4 ms.
Claim:      The per-system detail families dominate buildStateFrame at 20K; the coarse set
            (map layers + attention + aggregates) builds in <= ~250 ms per push.
Horizon:    founding era (t=10) only. Coarse-set entries scale with CONTENT (developed cohort,
            markets, events, player systems), not total systems — the two total-system-scaled
            coarse slices measured (universe, visibility, map layers) are the cheap ones.
Cohort:     same fixture as I1; 29 factions, 26 goods, 0 controlled systems, no player seat.
Licenses:   Supports: premise 2 CONFIRMED — coarse set beats the 250 ms bar by ~15x; pushing it
            every window is affordable. Supports: substrate is the single biggest family (1.65 s
            — 40% of the frame) and is STATIC world data per system, a natural push-once or
            read-command slice. Does NOT support: alerts/tracker cost in a real game — the
            fixture has NO PLAYER SEAT, so both read defaults (~0 ms); their real cost scales
            with player content and is unmeasured (hypothesis: small, same content-scaling
            class as factionAggregates). Does NOT support: equilibrium coarse-set cost —
            marketComparison/tradeFlow grow with the market/flow population.
```

### I3 — autosave split (Idea premise 3)

```
Meaning:    Serialisation is innocent: stringifying the whole 20K world costs ~0.12 s — the
            browser's ~47 s autosave is >=99% NOT serialisation, so it is the IndexedDB write
            and/or event-loop starvation while 8.7 s frame builds saturate the worker, and a
            structured-clone handoff to a save worker is cheap if ever needed.
Claim:      How the ~47 s browser autosave divides between JSON.stringify and the IndexedDB
            write; what a structured-clone World handoff costs.
Number:     serialiseWorld (JSON.stringify): 120 / 118 / 116 ms. Save size 37.0 MB.
            structuredClone(world): 184 / 132 / 132 ms. JSON.parse of the save: 70-73 ms.
            (Browser-side stringify-vs-IDB attribution of the 47 s residual: unmeasured — needs
            a browser reading, see Licenses.)
Horizon:    founding era (t=10) only; save size and all costs grow with content over a campaign.
Cohort:     same 20K fixture; Node (V8) — same engine family as Chrome, absolute ms transfer
            approximately.
Licenses:   Supports: the autosave sub-direction does NOT need a serialisation fix; the ~130 ms
            clone makes an off-thread save worker viable but possibly unnecessary. Supports:
            the B1 47 s reading is dominated by whatever the frame fix removes (loop saturation)
            plus the IDB write of a 37 MB string — attribution BETWEEN those two is unmeasured
            and only a browser reading after the frame fix can split them. Does NOT support:
            "IndexedDB takes 47 s" (never isolated); ruling out slow IDB writes on real user
            disks. The spec should treat the browser re-read post-frame-fix as the gate on
            whether autosave needs its own mechanism at all.
```

**Outcome vs the terminal falsifier: the direction SURVIVES** — single-id derivation is ~0.2-1 ms
against the 500 ms kill line, and both checkable premises are confirmed at the committed fixture.
Next: `/feature-spec` from this evidence.

## Spec — frame architecture

```
What changes:  The game worker stops rebuilding every system's panel detail on every push. Each
               push now carries only what the whole screen can show at once — the map layers, the
               attention surfaces, and per-faction summaries — plus full detail for just the
               panels the player currently has open. The UI tells the worker which panels those
               are, and the worker answers a panel opening with a fresh frame immediately. At
               20,000 systems the game becomes playable at max speed instead of freezing for
               seconds per frame; autosave cadence is unchanged and its remaining cost is
               re-measured once frames are fixed.
Why:           At 20K systems a tick costs ~0.1 s but one state frame costs ~8.7 s and the 60 s
               autosave ~47 s — the worker spends 87-99% of its time on host work (B1). Owner
               decisions encoded: direction "pull-based frames — push coarse map slices +
               aggregates; derive panel detail on demand over the command channel; dirty-sets
               only where processors make them free; autosave off the hot path separately"
               (2026-08-20, roadmap row); the shape "B with A's read command as a first-class
               part of it" — proposed with "which slice uses which mechanism becomes a per-slice
               call at spec time", owner: "Yeah sounds good thanks for the explanation";
               interest-set scope — owner questioned "the 'handful' of systems… the tracker,
               alerts etc." and accepted that alerts/tracker are worker-derived pushed slices,
               so the interest set is the open panels; watch-item "at 20K full-map zoom-out
               everything is visible, and wars/battles/ship units will widen what the map needs"
               (2026-08-20); 20K galaxy is the acceptance fixture (roadmap row).
Evidence:      I1 — single-id panel detail is ~0.2-1 ms/id (max 4.7) at 20K; licenses: confirmed
               at founding era only, per-id cost scales with content, equilibrium unmeasured.
               I2 — detail families are ~99.5% of frame cost (~3.5 s); coarse set ~17 ms;
               licenses: alerts/tracker measured with no player seat (~0, unrepresentative);
               marketComparison/tradeFlow grow with market/flow population; substrate (1.65 s)
               is static per-system data. I3 — serialiseWorld ~120 ms / 37 MB, structuredClone
               ~130 ms; licenses: the browser 47 s is loop saturation + IDB write, attribution
               between them unmeasured — the post-frame-fix browser re-read is the gate on
               whether autosave needs its own mechanism. B1 — browser worker share%
               tick/frame/idle ≈ 1/99/0 at 20K; licenses: founding era, dev build.
Not claimed:   No engine tick speedup — the ~5-10 TPS engine ceiling at 20K (C1) is untouched;
               this feature removes the HOST bottleneck only. No dirty-sets or incremental
               frames — every frame is still fully rebuilt, just smaller; the markets
               dirty/ownership row stays independent. No map-rendering (Pixi) changes. No
               save-format or autosave-cadence change, and no save worker in this feature — that
               is a gated follow-up. No equilibrium-era performance guarantee: every number is
               founding-era, and coarse-set cost grows with content (I2 licenses). A skimmer
               might read "pull-based" as request/response reads with loading states — wrong:
               open-panel detail still arrives by push, and hooks stay synchronous.
```

### Frame contents — the per-slice assignment

Two delivery classes replace today's all-slices frame (`buildStateFrame` derives every per-id
slice for every system, `lib/runtime/snapshot.ts:210-289`):

**Pushed coarse set** — in every state frame, exactly as assembled today (receipts:
`lib/runtime/snapshot.ts:254-286`): `atlas`, `universe`, `visibility`, `events`, `alerts`,
`tracker`, `playerSettings`, `ownership`, `stability`, `population`, `development`, `migration`,
`provision`, `factions`, `relations`, `tradeFlow`, `factionVitals`, `factionConstruction`,
`factionTreasury`, `factionDetail`, `constructionStalls`. Measured sum ~17 ms at 20K (I2;
faction aggregates 10.4 ms of it, scaling with faction count ~29, not system count). This is the
"whole screen at once" set: full-galaxy map layers (owner watch-item), the attention layer, and
every faction surface. Wars/battles/ship-unit layers join this class when they exist.

**Interest-keyed detail** — in a frame only for ids in the current interest set:

- keyed by **system id**: `systemVitals`, `systemPopulation`, `systemIndustry`,
  `systemLogistics`, `systemConstruction`, `systemBuildOptions`, `systemSubstrate`, `market`
  (the 8 families, `snapshot.ts:220-234`), plus `colonyEligibility` for that system when
  controlled (`snapshot.ts:183-190`). Measured ~0.2-1 ms per id (I1).
- keyed by **good id**: `marketComparison` — the comparison panel opens on one good across
  systems (`snapshot.ts:79-82`), so its interest key is the good, not a system.

No slice is assigned to request/response reads at introduction: the read-command mechanism
already exists (pure-read commands `listSaves`, dev `economySnapshot`/`inspectWorld` —
`client/worker/game-worker.ts:355-358,427-436`) and new one-shot reads join `GameCommandMap`
the ordinary way; nothing currently needs one.

**Self-containment invariant:** every frame carries the ENTIRE current interest set's detail,
never a delta — the drop-harmless guarantee (`snapshot.ts:22-24`) continues to hold with "full"
redefined as "coarse set + whole interest set".

### Interest protocol

A new inbound worker message alongside `subscribe` (`client/worker/game-worker.ts:104-107`):
`{ type: "interest", systems: string[], factions: string[], goods: string[] }` — new, emitted by
the UI-side worker connection. Semantics:

- **Replace-whole-set, idempotent.** The worker holds exactly the last-received set; no
  ref-counting, no incremental add/remove. `factions` is accepted for forward-compatibility and
  unused at introduction (every faction slice is pushed-coarse).
- **Immediate reply.** An interest message that GROWS the set is answered with a state frame at
  once (same pattern as `subscribe`'s immediate reply, `game-worker.ts:560-563`), so opening a
  panel costs one postMessage round trip (~ms), not a wait for the next throttle window. A
  shrink-only change waits for the next scheduled frame.
- **Frame freshness moves to a send counter** (spec-review finding 1, accepted). Frame contents
  now vary with the interest set, not only with world state, so two frames at one `worldVersion`
  can legitimately differ — and `applyStateFrame`'s strictly-newer-version guard
  (`lib/store/game-store.ts:157`) would drop an interest reply built between world commits (the
  guaranteed case: the game is PAUSED — `worldVersion` advances only via `setWorld`/`clearWorld`,
  `lib/world/store.ts`, and no tick runs while paused — so an opened panel would never fill).
  Every `StateFrame` therefore additionally carries `frameSeq`: a worker-side monotonic counter
  bumped on every send (new — emitted where the worker posts state frames). The store applies a
  frame when `frameSeq` is strictly newer; `worldVersion` keeps its remaining jobs unchanged
  (no-world sentinel, replacement floor, world-swap detection — `game-store.ts:44-58`).
- **Stale or unknown ids never throw** (spec-review finding 2, accepted). The per-id read
  services throw `ServiceError("not_found")` for a missing id (e.g.
  `lib/services/system-vitals.ts:20`), and the command path's follow-up `pushStateFrame()` runs
  outside any catch (`game-worker.ts:589-594`) — an interest id absent from the world would kill
  the promised frame silently. Frame assembly therefore SKIPS an interest id that does not exist
  in `world.systems`/`GOODS`, omitting its key, rather than letting the lookup throw; this guard
  lives in the interest loop itself so it covers every stale-id source. Additionally, the worker
  clears its held interest set when a `newGame`/`loadGame` command commits (the set is
  world-scoped state; a live worker survives exit-to-menu → new game), and the shell re-posts
  interest after the replacement's first frame lands.
- **UI derivation.** The shell derives the set from what is open — the routed panel's id plus
  any open detail popovers — and re-posts it on route/popover change. The empty set is valid
  (map only): frames carry the coarse set alone.
- **First-paint gate.** Between a panel opening and its frame landing, the panel's id is absent
  from the detail slices. Exactly ONE presence gate, at the panel root, holds the panel's shell
  until the id's entry exists; every hook below it stays a synchronous non-null selector — the
  no-loading-checks convention holds everywhere except that single root gate.
- **Command ordering preserved.** A command's result is still followed immediately by a state
  frame with no interleaving await (`game-worker.ts:589-594`); that frame carries the interest
  set's detail, so the panel the player is acting in updates in the same message pair the
  command-overlay contract requires.

### Store and signature consequences

- **Store merge is already correct for partial frames**: `applyStateFrame` spreads
  `frame.slices` over held slices — a slice present in the frame replaces wholesale, an absent
  slice persists (`lib/store/game-store.ts:160`). Consequence: each detail record contains only
  the current interest set's ids (closing a panel drops its entry on the next frame), and every
  coarse slice stays complete. `worldVersion` freshness, the replacement floor, and liveness
  semantics are untouched (`game-store.ts:155-170,190-216`).
- **`buildStateFrame(world, since)` becomes `buildStateFrame(world, interest)`**: the `since`
  parameter has been `void`-ed since introduction (`snapshot.ts:210-211`) and its dirty-set
  future is explicitly not this feature (roadmap "Markets need a real dirty/ownership model");
  it retires now rather than surviving as a stranded parameter. The world-less frame
  (`worldVersion: 0`, empty slices — `game-worker.ts:501-503`) is unchanged.
- **`StateFrame` gains one field**: `frameSeq` (the send counter above) joins `worldVersion` +
  `Partial<SnapshotSlices>` (`snapshot.ts:154-157`); which keys a frame populates changes per
  the assignment table. `applyStateFrame`'s freshness guard reads `frameSeq`; every other
  `worldVersion` consumer is untouched.
- **The hooks' absence fallback gets a second meaning, documented and diagnosable**
  (spec-review finding 3, accepted in strengthened form). Today every detail hook's
  `?? NOT_FOUND`/empty fallback is documented and test-pinned as "this id does not exist in the
  world" (e.g. `lib/hooks/use-system-substrate.ts:6-8`;
  `lib/hooks/__tests__/use-per-id-defaults.test.tsx`,
  `use-per-id-existing-discriminant.test.tsx`); interest-keying adds the routine second meaning
  "exists, not currently subscribed". The build plan: (a) rewrites those docstrings to state
  both meanings; (b) updates the two test suites to cover "never existed" and "not subscribed"
  as distinct cases; (c) the panel-root presence gate decides EXISTENCE from the coarse
  `universe` slice (always pushed, carries every system id) and PRESENCE from the detail slice —
  and a frame carries a subscribed id's whole family bundle atomically, so once the gate clears,
  the hooks' fallbacks are provably unreachable below it; (d) dev builds only: a detail hook
  read for an id that exists in `universe` but is absent from its detail slice logs a console
  warning naming the id and the missing interest registration — so a future surface calling a
  detail hook without wiring interest announces itself at first render instead of shipping
  confidently-wrong "unknown" data. Production behaviour: gate + fallback, no warning cost.

### Autosave

Cadence, trigger points and mechanism are all unchanged: 60 s interval + on pause
(`lib/world/tick-loop.ts:58,119,236-237`), write-then-swap IndexedDB backend
(`client/save-indexeddb.ts:136-151`), serialisation via `serialiseWorld`
(`tick-loop.ts:332-338`). I3 exonerates serialisation (~120 ms at 37 MB), so this feature
changes autosave only by unsaturating the loop around it. **Gate:** the acceptance smoke
re-measures autosave wall time in the browser at the 20K fixture; if a player-visible stall
(> ~2 s of unresponsiveness attributable to the autosave window) remains, the follow-up is a
dedicated save worker fed by `structuredClone` (~130 ms, I3) — booked as a roadmap row at that
point, never built speculatively in this PR.

### Acceptance (browser, real Chrome, 20K fixture — seed 42, founding era; re-create the
`?tickdiag` relay instrument from this file's description)

1. Frame work (build + post) < 10% of worker busy time at max speed with one system panel and
   one faction panel open — inverts falsifier B (B1 measured 87-99%).
2. Frame build ≤ 100 ms per push under the same conditions (I2 coarse ~17 ms + detail ~1 ms/id
   + assembly headroom; the bound is deliberately loose for the dev build).
3. Tick work dominates: share% tick ≥ 80% at max speed, i.e. achieved TPS is engine-limited,
   not host-limited (no absolute TPS promise — the engine ceiling at 20K is C1's extrapolated
   ~5 TPS and not this feature's to move).
4. Autosave gate as above; record the reading either way.
5. 600-system smoke, pinned (spec-review finding 4, accepted): metric is `achievedTps` from the
   pacing frames; comparator is C1's 600-system Node reading (118.8 TPS at t≈10,000); the
   browser reading is taken on a 600-system save advanced to ≈t 10,000 via the dev
   `advanceTicks` command; pass = browser `achievedTps` within 10× of the comparator (closes
   the 4-vs-75 anecdote's mechanism to the extent B's content-scaling explanation covers it —
   Claim A stays dismissed-not-ruled-out).
6. Paused-panel case (spec-review finding 1, accepted): pause the game, open a system panel —
   the panel renders its detail without waiting for a tick.

### Hazard worksheet (scope: runtime/UI delivery change — rows 3 and 6 per the worksheet's own
scope rule; no economy, processor, world-state or shared-constant surface. Row 5-style producer
receipts are folded into the body's sentences above.)

**Row 3 — systems sweep:**

| System | Interaction with this change | Reason if none |
|---|---|---|
| Events | Delivery only: `events` slice stays pushed-coarse (`snapshot.ts:259`); pacing-frame notifications unchanged (`lib/runtime/channel.ts:9-15`) | — |
| Population + migration | Delivery only: map layers stay pushed (`snapshot.ts:264-267`); `systemPopulation` becomes interest-keyed | — |
| Unrest / regime | none | `stability` layer stays pushed (`snapshot.ts:263`); no data change |
| Industry + staffing | Delivery only: `systemIndustry` becomes interest-keyed | data content unchanged |
| Infrastructure decay | none | engine-side; frames are read-only derivations |
| Directed logistics | Delivery only: `tradeFlow` pushed, `systemLogistics` interest-keyed | — |
| Directed build / planner | Delivery only: `systemConstruction`/`systemBuildOptions` interest-keyed; `constructionStalls` stays pushed (`snapshot.ts:195-204`) | — |
| Colonisation + founding manifest | Delivery only: `colonyEligibility` rides the system detail bundle (`snapshot.ts:183-190`) | — |
| Treasury / purse | none | `factionTreasury` stays pushed-coarse (`snapshot.ts:249-251`) |
| Factions + relations | none | all faction slices stay pushed-coarse |
| Save format (`World` shape) | none | frames are never persisted; `serialiseWorld` serialises `World`, not frames (`lib/world/save.ts:54`); autosave cadence unchanged |
| Harness's own metrics | none | `npm run impact -- buildStateFrame`: "No production readers found" — the impact scan covers `lib/`/tick/harness and finds zero readers there (+1 test); the real callers are `client/worker/game-worker.ts:143,205,509` (client/ is outside the tool's scan — verified by direct read) and the harness never builds frames |

**Row 6 — metrics this spec targets:**

| Metric | Read at which cohort | What else moves this number |
|---|---|---|
| share% tick/frame/idle | 20K fixture, founding era, max speed, panels open as stated | era/content mass (developed cohort fattens both tick and frame terms); machine; dev-vs-prod build (B1 licenses); how many panels are open |
| frame build ms/push | same | interest-set size; content per subscribed system (I1 licenses: developed ≫ undeveloped); JIT warmup (first-run 2-4× — I2 full-run spread) |
| achieved TPS | same + 600-system smoke | ENGINE cost (C1 curve) — the reason acceptance is share-based, not TPS-based |
| autosave wall ms | 20K fixture, browser | IDB write on the user's real disk; content growth over a campaign (I3 licenses) |

### Falsifier (committed at `8f518222`, moved here unedited)

**If deriving one system's full panel detail at the 20K fixture measures ≥ ~500 ms per call —
within an order of magnitude of building the full frame — and cannot be brought under ~10 ms by
scoping the existing read services (i.e. their galaxy-scale intermediates are irreducible per
call), the direction is dead:** subscribed detail would cost like full frames the moment a few
panels are open, and the fix must instead be incremental push gated on the markets
dirty/ownership model row. Units: ms per single-id detail derivation; fixture: 20K systems,
seed 42, founding era.

*(Measured outcome: I1 — cleared by three orders of magnitude.)*
