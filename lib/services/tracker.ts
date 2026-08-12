/**
 * Tracker read service — the roll-up behind the Tracker panel's three sections
 * (docs/active/gameplay/tracker.md): pinned systems, the player faction's funded construction
 * front, and its forming colonies. Pure marshalling over `getSystemVitals` (a pinned row's figures)
 * and `getFactionConstruction` (building/colonising) — no new derivation of its own.
 *
 * A world with no player seat (e.g. the calibration harness) has nothing to track: every section
 * reads empty rather than throwing, so the panel degrades instead of blanking the shell around it.
 */
import { getWorld } from "@/lib/world/store";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { getFactionConstruction } from "@/lib/services/construction";
import type {
  TrackerData,
  TrackerPinnedRow,
  TrackerBuildRow,
  TrackerColonyRow,
} from "@/lib/types/api";

const EMPTY_TRACKER: TrackerData = { pinned: [], building: [], waitingCount: 0, colonising: [] };

export function getTrackerData(): TrackerData {
  const world = getWorld();
  const player = world.player;
  if (!player) return EMPTY_TRACKER;

  // Stale pins are filtered here, not pruned on write (no processor touches pinnedSystemIds — see
  // WorldPlayer's docstring). A pin naming a system that no longer exists, or one that has been
  // abandoned back to unclaimed (or is still only controlled, not yet developed), reads no vitals —
  // both are dropped rather than rendered with zeroed figures. Order is preserved: this walks
  // `pinnedSystemIds` in its own stored order and never re-sorts.
  const pinned: TrackerPinnedRow[] = [];
  for (const systemId of player.pinnedSystemIds) {
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
      provisionPct: vitals.provision.assessed ? vitals.provision.pct : 0,
      developmentPct: vitals.development.pct,
    });
  }

  // Pinning is a bookmark, not an ownership claim — deliberately no factionId filter above: a
  // pinned system belonging to another faction still reads its own vitals the same way.

  const construction = getFactionConstruction(player.controlledFactionId);

  // The front mixes build and colony_establish rows; split on the row's own `kind` rather than an
  // inferred invariant about which control state each project kind targets.
  const building: TrackerBuildRow[] = construction.fundedFront
    .filter((row) => row.kind === "build")
    .map((row) => ({
      projectId: row.projectId,
      systemId: row.systemId,
      systemName: row.systemName,
      label: row.label,
      progress: row.progress,
      etaCycles: row.etaCycles,
    }));

  // Every colony forming gets a row, funded this cycle or not — the front only decides whether the
  // row's ETA is currently forecastable, never whether the colony appears at all.
  const frontBySystemId = new Map(construction.fundedFront.map((row) => [row.systemId, row]));
  const colonising: TrackerColonyRow[] = construction.colonies.map((colony) => ({
    systemId: colony.systemId,
    systemName: colony.systemName,
    label: "Establish Colony",
    progress: colony.progress,
    etaCycles: frontBySystemId.get(colony.systemId)?.etaCycles ?? null,
  }));

  // `construction.waitingCount` is the engine's own figure: open projects (builds AND colonies)
  // behind the front. The Tracker's `waitingCount` documents a narrower thing — build projects only,
  // not currently absorbing pool — because every colony already gets its own row in `colonising`
  // whether or not it is funded this cycle; counting it again here would double-represent it. Builds
  // have no such standalone list, so they alone collapse to a count. Derived from `buildSystems`
  // (every open build project, funded or not, grouped by system) minus the builds already on the
  // front, rather than touching the engine-level figure Task 2 pins.
  const totalBuildProjects = construction.buildSystems.reduce((sum, s) => sum + s.count, 0);
  const waitingCount = totalBuildProjects - building.length;

  return { pinned, building, waitingCount, colonising };
}
