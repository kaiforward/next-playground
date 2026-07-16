/**
 * Calibration harness runner — generate a world, loop `runWorldTick`,
 * snapshot/analyze. A thin wrapper over the shared tick pipeline
 * (`lib/world/tick.ts`): `runTickHarness` exists to drive the real engine for
 * calibration health checks, not to simulate player trading. There is no bot
 * layer and no per-run constants override — it runs the same code constants
 * the live game does.
 */

import { generateWorld } from "@/lib/world/gen";
import { runWorldTick, toTickSystems, toTickMarkets } from "@/lib/world/tick";
import { takeMarketSnapshot, computeMarketHealth, SNAPSHOT_INTERVAL } from "./market-analysis";
import {
  trackEventLifecycles,
  flushActiveEvents,
  computeEventImpacts,
} from "./event-analysis";
import type { GovernmentType } from "@/lib/types/game";
import type {
  HarnessConfig,
  HarnessResults,
  MarketSnapshot,
  EventLifecycle,
  RegionOverviewEntry,
} from "./types";
import type { TickEvent, TickMarket } from "@/lib/tick/rows";

/** Mirrors event-analysis.ts's (unexported) ActiveEventRecord shape. */
interface ActiveEventRecord {
  type: TickEvent["type"];
  systemId: string | null;
  severity: number;
  startTick: number;
  sourceEventId: string | null;
  startPrices: { goodId: string; price: number }[];
}

/**
 * Run the full calibration harness and return results.
 */
export async function runTickHarness(config: HarnessConfig, label?: string): Promise<HarnessResults> {
  const start = performance.now();

  let world = generateWorld({ systemCount: config.systemCount, seed: config.seed });

  // Region overview — dominant government type per region, derived from
  // faction ownership. Ties broken alphabetically.
  const tickSystemsAtStart = toTickSystems(world);
  const systemsByRegion = new Map<string, GovernmentType[]>();
  for (const s of tickSystemsAtStart) {
    const list = systemsByRegion.get(s.regionId) ?? [];
    list.push(s.governmentType);
    systemsByRegion.set(s.regionId, list);
  }
  const regionOverview: RegionOverviewEntry[] = world.regions.map((r) => {
    const govs = systemsByRegion.get(r.id) ?? [];
    const counts = new Map<GovernmentType, number>();
    for (const g of govs) counts.set(g, (counts.get(g) ?? 0) + 1);
    let dominant: GovernmentType = "federation";
    let bestCount = 0;
    for (const [g, count] of counts) {
      if (count > bestCount || (count === bestCount && g < dominant)) {
        dominant = g;
        bestCount = count;
      }
    }
    return {
      name: r.name,
      dominantGovernmentType: dominant,
      systemCount: govs.length,
    };
  });

  const marketSnapshots: { tick: number; markets: MarketSnapshot[] }[] = [];
  const populationSnapshots: Array<Map<string, number>> = [];
  const activeEventTracker = new Map<string, ActiveEventRecord>();
  const completedEvents: EventLifecycle[] = [];

  const initialPopulationTotal = world.systems.reduce((sum, s) => sum + s.population, 0);
  const initialBuildingTotal = tickSystemsAtStart.reduce(
    (sum, s) => sum + Object.values(s.buildings).reduce((a, c) => a + Math.max(0, c), 0),
    0,
  );

  // Kept in sync with `world` every tick — reused as both this tick's
  // post-tick snapshot and next tick's pre-tick snapshot, so the good-catalog
  // join (toTickMarkets) runs once per tick instead of twice.
  let currentMarkets: TickMarket[] = toTickMarkets(world);

  for (let t = 0; t < config.tickCount; t++) {
    const preTickMarkets = currentMarkets;

    const result = await runWorldTick(world);
    world = result.world;
    // runWorldTick already built this tick's market rows internally —
    // reuse it instead of re-running the toTickMarkets join over `world`.
    currentMarkets = result.markets;

    if (world.meta.currentTick % SNAPSHOT_INTERVAL === 0) {
      marketSnapshots.push({ tick: world.meta.currentTick, markets: takeMarketSnapshot(currentMarkets) });
      const popSnap = new Map<string, number>();
      for (const s of world.systems) popSnap.set(s.id, s.population);
      populationSnapshots.push(popSnap);
    }

    completedEvents.push(
      ...trackEventLifecycles(
        world.events,
        currentMarkets,
        world.meta.currentTick,
        activeEventTracker,
        preTickMarkets,
      ),
    );
  }

  // Flush any events still active at simulation end.
  completedEvents.push(...flushActiveEvents(activeEventTracker, world.meta.currentTick, currentMarkets));

  // Always capture the final tick if not already sampled.
  if (
    marketSnapshots.length === 0 ||
    marketSnapshots[marketSnapshots.length - 1].tick !== world.meta.currentTick
  ) {
    marketSnapshots.push({ tick: world.meta.currentTick, markets: takeMarketSnapshot(currentMarkets) });
  }

  const marketHealth = computeMarketHealth(currentMarkets);

  const systemNames = new Map(world.systems.map((s) => [s.id, s.name]));
  const eventImpacts = computeEventImpacts(completedEvents, systemNames);

  return {
    config,
    marketSnapshots,
    marketHealth,
    eventImpacts,
    regionOverview,
    label,
    elapsedMs: performance.now() - start,
    finalWorld: world,
    initialPopulationTotal,
    initialBuildingTotal,
    populationSnapshots,
  };
}
