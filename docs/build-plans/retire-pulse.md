# Build plan — retire "pulse"

One PR into `feat/band-reconciliation`. Two halves of the same naming problem plus one folded-in
unit-correctness fix.

## The vocabulary

"Pulse" currently does three jobs. Each gets its own word.

| concept | question it answers | word |
|---|---|---|
| the 24-tick resolution period | how long | **cycle** |
| the tick where `tick % interval === 0` | when | **cycle start** |
| what happens on that tick | what | **resolution** (verb/noun in prose, not an identifier prefix) |
| every other tick | when | **mid-cycle** |

`isCycleStart(tick, cycleLength)` is generic over all three cadences — `cadence.cycle`,
`cadence.logistics`, `cadence.construction` — and reads correctly for each ("is this the start of a
logistics cycle"). That genericity is why "cycle start" beats "resolution tick" for the predicate:
there are three resolutions on three periods, not one.

## Step 1 — event sense (~93 occurrences, 20 files)

| today | becomes |
|---|---|
| `isPulseTick` | `isCycleStart` |
| `pulseShard` | `cycleStartShard` |
| `SystemCadence.pulseGroup` | `SystemCadence.resolutionGroup` |
| `economyOffPulsePayload` | `economyMidCyclePayload` |
| `sawOffPulseAccrual` | `sawMidCycleAccrual` |
| prose "on the cycle pulse" | "on the cycle start" / "when the cycle resolves" |
| prose "off-pulse" | "mid-cycle" |

`resolutionGroup` over `cycleShardGroup`: it is a player-facing API field driving the header "next
update" countdown, and sharding is a performance concept AGENTS.md keeps out of gameplay surfaces.

## Step 2 — unit sense (~400 occurrences)

Identifiers: `squeezePulses`, `proposalPulses`, `proposalPulseUpdates`, `etaPulses`,
`forecastEtaPulses`, `forecastIndependentEtaPulses`, `queueEtaPulses`, `foodPulses`, `orePulses`,
`maxPulses`, `nextPulses`, `maxLevelsPerPulse`, `maxClaimsPerPulse` / `MAX_CLAIMS_PER_PULSE`,
`meanPerPulse`, `nextPulseGain(s)`, `pulseCount`, `migrationPulseCount`, `excessByPulse`,
`unrestByPulse`, `shortagePulse`, `protectedPulse`, `landedAtPulse`, `landingPulse`, `landedPulse`,
`ordinaryPulse` — `Pulse(s)` → `Cycle(s)`, plus the bare "pulses" unit prose.

Player-visible copy needs re-flowing, not replacing:
- `construction-row.tsx` — `+${rate}/pulse` → `/cyc` (matches the logistics panel's existing suffix)
- `faction-construction-card.tsx` — `pool …/pulse` → `/cyc`
- `treasury-card.tsx` — "lands on the next cycle pulse" → "lands on the next cycle start"

## Step 3 — save bump

`squeezePulses` and `proposalPulses` are persisted `WorldMarket` fields. `SAVE_FORMAT_VERSION`
9 → 10, and its assertion in `lib/world/__tests__/save.test.ts`. `deserializeWorld` hard-rejects a
version mismatch, so there is no migration path to write. Free while the work sits on the shared
branch — `main` only observes the final number at merge.

## Step 4 — `cyclesInWindow` → `referenceCyclesInWindow` (folded-in [S])

`buildLogisticsRows`' third parameter normalises window-summed imports/exports so the External column
shares units with Internal production/consumption. The docstring claims per-economy-cycle; the caller
divides by `FLOW_HISTORY_TICKS / LOGISTICS_INTERVAL`. Both are wrong for the stated purpose.

The Internal column shows the raw `capacityGoodRates` rate. The economy processor applies it scaled by
`catchUpFactor(CYCLE_LENGTH)` once per cycle, so throughput is `rate` per **`REFERENCE_INTERVAL`
ticks** at any cycle length. Directed logistics scales identically, so the window sum is
`rate × FLOW_HISTORY_TICKS / REFERENCE_INTERVAL`, invariant to `LOGISTICS_INTERVAL`.

| divisor | External reads | correct when |
|---|---|---|
| `W / LOGISTICS_INTERVAL` (shipped) | `rate × L/24` | `L = 24` |
| `W / CYCLE_LENGTH` (docstring intent) | `rate × C/24` | `C = 24` |
| `W / REFERENCE_INTERVAL` | `rate` | always |

Rename to `referenceCyclesInWindow` ("reference cycle" is already the codebase's phrase), divide by
`REFERENCE_INTERVAL`, and make the docstring say per-reference-interval. **This is a divisor change,
not a rename** — a no-op at the shipped config (`L = C = 24`), diverging only if a cadence knob moves.
Accepted knowingly.

Residual left as a docstring note, not fixed: at `CYCLE_LENGTH ≠ 24` both columns correctly read
per-reference-interval while the `/cyc` label claims per-cycle. The columns agree with each other under
any knob; only the label disagrees, and choosing its replacement is a separate display decision.

## Step 5 — verify

`npx tsc --noEmit`, `npx vitest run`, `npx next build --webpack`, `npm run simulate` (behaviour must be
identical — renames plus a no-op divisor).

## Sweep traps — review checklist

Green checks prove the identifier half only. Four of these bit on #204; the fifth is new.

1. **A quoted citation of superseded wording stays quoted.** #204 rewrote `the "days-of-supply"
   wording … is legacy` into `"cycles-of-supply"`, making a normative doc instruct reverting the PR.
2. **Real-world durations are not the in-fiction unit.** Check any table headed *real-time duration*.
3. **Adverb → noun needs re-flowing.** "billed monthly" → "billed cycle" happened twice in `SPEC.md`.
4. **Renaming a term next to a stale unit exposes it.** Re-read neighbouring unit claims.
5. **`animate-pulse` is a Tailwind utility** (`components/top-bar.tsx:54`) — a blanket replace kills
   the live-tick indicator's animation and nothing in tsc/tests/build catches it. Verified to be the
   only foreign use of the word: no `*.css` match, no `.json`/`.yaml`/`.mjs` match, and no `pulses`
   food good in `GOODS`.

Not swept, deliberately (same call as #204): `docs/build-plans/` (transient, deleted with their
features).
