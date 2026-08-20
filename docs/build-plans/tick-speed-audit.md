# Tick-speed acceptable-maximum audit — working file

**Outcome (2026-08-20): Claim B CONFIRMED** (evidence below) — the browser worker's collapse is
host-side frame derivation + autosave, not the engine. Claim A is subsumed by B's mechanism
(content-scaled host cost; no separate 600-scale reading taken — the owner judged the 20K result
decisive and the 4-vs-75 anecdote a likely one-off). Claim C is PARKED (Node projections lean
false — ~19.5 TPS extrapolated at 10K equilibrium — but unmeasured; the big runs were deliberately
not spent on). Next: `/brainstorm` the pull-based frame architecture (new session; roadmap row
"Frame architecture" carries the agreed direction and the merge-blocking decision). Instruments
were reverted per the measure rule; temp/tick-timing-diag.ts (gitignored) survives, and the
`?tickdiag` worker instrument can be re-created from this file's description + git history of the
session if the spec pass wants live readings again.

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

### Node calibration (per-processor, both eras at 600; startup at 2000) — summary

Instrumented `runWorldTick` (tagged patch, validated: byte-identical world evolution, residual
42-47% = join/merge machinery scaling with total systems). 600 systems: ordinary tick median
1.71 ms (startup) / 4.25 ms (equilibrium); cycle-start 21.79 / 101.62 ms; directed-build is the
largest cycle-start line everywhere (scans the full system list). Extrapolated equilibrium TPS:
~56 at 2000 systems, ~19.5 at 10K (two-point exponent fit — unmeasured, the parked big runs
would confirm). Raw JSONL in temp/tick-timing-*.jsonl (gitignored).
