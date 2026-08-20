# Tick-speed acceptable-maximum audit — working file

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
