/**
 * Tracker read service — the roll-up behind the Tracker panel's three sections
 * (docs/active/gameplay/tracker.md): pinned systems, the player faction's funded construction
 * front, and its forming colonies. Pure marshalling over `getSystemVitals` (a pinned row's figures)
 * and `readoutForFaction` (building/colonising) — no new derivation of its own.
 *
 * It reads the construction READOUT rather than `getFactionConstruction`'s client DTO: the rows it
 * needs (the funded front, and every colony's own ETA) are server-side quantities no client
 * component renders, and widening the DTO to carry them would ship three fields to the browser for
 * one server-to-server read.
 *
 * A world with no player seat (e.g. the calibration harness) has nothing to track: every section
 * reads empty rather than throwing, so the panel degrades instead of blanking the shell around it.
 */
import { getWorld } from "@/lib/world/store";
import { DEFAULT_TRACKER_SECTIONS } from "@/lib/constants/attention";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { readoutForFaction } from "@/lib/services/construction";
import { workShareOf } from "@/lib/engine/construction-readout";
import type {
  TrackerData,
  TrackerPinnedRow,
  TrackerBuildRow,
  TrackerColonyRow,
} from "@/lib/types/api";

const EMPTY_TRACKER: TrackerData = {
  pinnedSystemIds: [],
  pinned: [],
  building: [],
  waitingCount: 0,
  colonising: [],
  // No seat means no stored preference to read; the panel has nothing to render either way.
  sections: DEFAULT_TRACKER_SECTIONS,
};

export function getTrackerData(): TrackerData {
  const world = getWorld();
  const player = world.player;
  if (!player) return EMPTY_TRACKER;

  // The write path accepts a pin on any system, so the stored list crosses the wire unfiltered:
  // it is what a pin-state control (the system header's star toggle) joins against. `pinned` below
  // is the narrower DISPLAY list — joining a toggle against that one would render a stored pin as
  // unpinned and leave the player unable to clear it.
  const pinnedSystemIds = [...player.pinnedSystemIds];

  // Stale pins are filtered here, not pruned on write (no processor touches pinnedSystemIds — see
  // WorldPlayer's docstring). A pin naming a system that no longer exists, or one that has been
  // abandoned back to unclaimed (or is still only controlled, not yet developed), reads no vitals —
  // both are dropped rather than rendered with zeroed figures. Order is preserved: this walks
  // `pinnedSystemIds` in its own stored order and never re-sorts.
  const pinned: TrackerPinnedRow[] = [];
  for (const systemId of pinnedSystemIds) {
    const system = world.systems.find((s) => s.id === systemId);
    if (!system) continue;
    const vitals = getSystemVitals(systemId);
    if (vitals.visibility !== "visible") continue;
    pinned.push({
      systemId,
      systemName: system.name,
      population: vitals.population.headcount,
      populationPct: system.popCap > 0 ? (system.population / system.popCap) * 100 : 0,
      stabilityPct: vitals.stability.pct,
      unrest: vitals.stability.unrest,
      // null, not 0: a system the economy has never assessed has no reading at all, and a 0 here
      // would render as a measured famine. Every other surface distinguishes the two the same way.
      provisionPct: vitals.provision.assessed ? vitals.provision.pct : null,
      developmentPct: vitals.development.pct,
    });
  }

  // Pinning is a bookmark, not an ownership claim — deliberately no factionId filter above: a
  // pinned system belonging to another faction still reads its own vitals the same way.

  const readout = readoutForFaction(player.controlledFactionId);

  // The front mixes build and colony_establish rows; split on the row's own `kind` rather than an
  // inferred invariant about which control state each project kind targets.
  const building: TrackerBuildRow[] = readout.fundedFront
    .filter((row) => row.kind === "build")
    .map((row) => ({
      projectId: row.projectId,
      systemId: row.systemId,
      systemName: row.systemName,
      label: row.label,
      progress: row.progress,
      nextCycleProgress: row.nextCycleProgress,
      etaCycles: row.etaCycles,
    }));

  // Every colony forming gets a row, funded this cycle or not, in queue order. Both figures come
  // off the colony's OWN row: `etaCycles` is forecast for a project behind the front too (the
  // forecast replays the queue until it lands), so reading it off the front instead would print
  // "stalled" (formatEta's no-forecast reading) over a starved colony that has a real landing cycle.
  const colonising: TrackerColonyRow[] = readout.all
    .filter((row) => row.kind === "colony_establish")
    .map((row) => ({
      systemId: row.systemId,
      systemName: row.systemName,
      label: "Establish Colony",
      progress: row.progress,
      nextCycleProgress: workShareOf(row.nextCycleGain, row.workTotal),
      etaCycles: row.etaCycles,
    }));

  // `readout.waitingCount` is the engine's own figure: open projects (builds AND colonies) behind
  // the front. The Tracker's `waitingCount` documents a narrower thing — build projects only, not
  // currently absorbing pool — because every colony already gets its own row in `colonising`
  // whether or not it is funded this cycle; counting it again here would double-represent it.
  // Builds have no such standalone list, so they alone collapse to a count.
  const totalBuildProjects = readout.all.filter((row) => row.kind === "build").length;
  const waitingCount = totalBuildProjects - building.length;

  return {
    pinnedSystemIds,
    pinned,
    building,
    waitingCount,
    colonising,
    sections: player.trackerSections,
  };
}
