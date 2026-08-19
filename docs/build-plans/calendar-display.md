# Calendar display

## Idea

Player-facing rendering of the fictional calendar the timescale work anchored. Unit structure
(decided, roadmap row): day = 4 ticks · month = 30 days · year = 12 months = 1,440 ticks — all
derived from the tick, never from `CYCLE_LENGTH`. Epoch year 2350; tick 0 renders `2350.01.01`.
Display-only; no save change; nothing in the tick reads any of it.

## Evidence

Survey of every tick-bearing UI surface (this branch, 2026-08-19): top bar renders `t.{tick}`
inline; durations come as raw ticks (event rows, alert flyout measures, cadence countdown) and as
construction cycles via `formatEta` / the Tracker's local `etaLabel`; absolute stamps at diplomacy
(`formed t.412`) and the start screen's save list. `ticksToHours` exists with zero UI callers.
`etaCycles` (`lib/engine/construction-readout.ts`) counts `CONSTRUCTION_INTERVAL` periods.

## Approved design (browser prototype, approved 2026-08-19)

- **Top bar:** gold date + time-of-day (`2350.01.01 06:00`, ticks step 00/06/12/18); raw tick
  survives only as a tooltip on the date. Dev tools keep raw ticks.
- **Durations:** one auto-scale rule everywhere — < 1 day → hours; < 45 days → days;
  < 300 days → months (half-month steps under 3); else years (tenths under 3). Per-cycle **rates**
  (`/cyc`, `pool 1.2k/cyc`, `net +240/cy`) are unchanged; the cycle keeps its name.
- **Stamps:** plain `YYYY.MM.DD`, zero-padded.

## Plan

1. `lib/constants/calendar.ts` — `EPOCH_YEAR`, `TICKS_PER_DAY` (derived `24 / HOURS_PER_TICK`),
   `DAYS_PER_MONTH`, `MONTHS_PER_YEAR`, derived ticks-per-month/year.
2. `lib/utils/calendar.ts` — `tickToDate`, `formatDate`, `formatTimeOfDay`, `formatDuration`
   (auto-scale). Node tests incl. boundaries (t=0, year rollover, each scale breakpoint).
3. `lib/utils/construction-format.ts` — `formatEta` converts cycles → ticks via
   `CONSTRUCTION_INTERVAL`, then `formatDuration`; `null` stays "stalled".
4. Surfaces: top bar readout (+tick tooltip, `title` like its siblings); Tracker `etaLabel` folded
   into `formatEta`; events page row + sort label; `active-events-section`; alert measure string
   (`lib/services/alerts.ts`); cadence countdown; diplomacy stamps + drift phrase; start-screen
   save entries; volume-sparkline axis/tooltip; speed-control titles ("6 in-world hours per
   second"); styleguide mono sample.

## Not covered

No processor or engine change; no save-format change; `npm run simulate` not applicable (pure
display). Rates keep `/cyc`. Dev tools keep raw ticks. Month names: none (numeric only).
