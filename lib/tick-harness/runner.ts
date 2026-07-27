/**
 * Calibration harness runner — generate a world, loop `runWorldTick`,
 * snapshot/analyze. A thin wrapper over the shared tick pipeline
 * (`lib/world/tick.ts`): `runTickHarness` exists to drive the real engine for
 * calibration health checks, not to simulate player trading. There is no bot
 * layer; it runs the same code constants the live game does, except for an
 * optional per-run cadence override (a dev/test surface) threaded from config.
 */

import { generateWorld } from "@/lib/world/gen";
import { runWorldTick, toTickSystems } from "@/lib/world/tick";
import { takeMarketSnapshot, computeMarketHealth, SNAPSHOT_INTERVAL } from "./market-analysis";
import {
  trackEventLifecycles,
  flushActiveEvents,
  computeEventImpacts,
} from "./event-analysis";
import { summarizeLogistics } from "./logistics-analysis";
import {
  summarizeBuildBursts, trackFoundedColonies, sampleFoundedColonies, hasColonyAwaitingSample,
  summarizeFoundingStock,
} from "./build-analysis";
import type { BuildCommitmentRecord, FoundedColonyRecord } from "./build-analysis";
import { MONTH_LENGTH } from "@/lib/constants/tick-cadence";
import { sampleTreasuries, summarizeTreasuries } from "./treasury-analysis";
import type { TreasurySnapshot } from "./treasury-analysis";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import type { GovernmentType } from "@/lib/types/game";
import type { WorldFlowEvent, WorldMarket } from "@/lib/world/types";
import type {
  HarnessConfig,
  HarnessResults,
  MarketSnapshot,
  EventLifecycle,
  RegionOverviewEntry,
  MigrationThroughputSummary,
} from "./types";
import type { TickEvent } from "@/lib/tick/rows";

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
  const treasurySnapshots: TreasurySnapshot[] = [];
  // Whole-run flow log. The world's own `flowEvents` is pruned to the retention
  // window every tick, so a run longer than that window can only be totalled by
  // taking each tick's transfers as they happen.
  const logisticsFlows: WorldFlowEvent[] = [];
  // Whole-run directed-build commitments, one record per (tick, good) this pulse committed new
  // autonomic levels for. Transient instrumentation (`runWorldTick().instrumentation`) — never
  // persisted in `World` — so, like flowEvents, it must be captured as each tick happens.
  const buildCommitments: BuildCommitmentRecord[] = [];
  // Whole-run migration throughput — colonist-delivery and edge-diffusion totals, plus the count
  // of pulses that resolved (the per-pulse mean's denominator). Transient instrumentation
  // (`runWorldTick().instrumentation`), so like buildCommitments it is accumulated per tick.
  let migrationPulseCount = 0;
  let migrationColonistsTotal = 0;
  let migrationDiffusionTotal = 0;
  const activeEventTracker = new Map<string, ActiveEventRecord>();
  const completedEvents: EventLifecycle[] = [];
  // Colonies founded in play, sampled at their first assessed month. Every system already developed
  // at tick 0 is world-gen's, not the colonisation loop's, so only later arrivals are tracked.
  const developedAtStart = new Set(
    tickSystemsAtStart.filter((s) => s.control === "developed").map((s) => s.id),
  );
  const foundedColonies = new Map<string, FoundedColonyRecord>();
  const monthLength = config.cadence?.month ?? MONTH_LENGTH;

  const initialPopulationTotal = world.systems.reduce((sum, s) => sum + s.population, 0);
  const initialBuildingTotal = tickSystemsAtStart.reduce(
    (sum, s) => sum + Object.values(s.buildings).reduce((a, c) => a + Math.max(0, c), 0),
    0,
  );

  // Kept in sync with `world` every tick — reused as both this tick's post-tick
  // snapshot and next tick's pre-tick snapshot, so a tick's market rows are held
  // across the loop boundary rather than re-read per use.
  let currentMarkets: WorldMarket[] = world.markets;

  for (let t = 0; t < config.tickCount; t++) {
    const preTickMarkets = currentMarkets;

    const result = await runWorldTick(world, config.cadence ? { cadence: config.cadence } : undefined);
    world = result.world;
    currentMarkets = result.markets;

    for (const f of world.flowEvents) {
      if (f.tick === world.meta.currentTick) logisticsFlows.push(f);
    }

    if (result.instrumentation.buildCommitmentsByGood) {
      for (const [goodId, levels] of result.instrumentation.buildCommitmentsByGood) {
        buildCommitments.push({ tick: world.meta.currentTick, goodId, levels });
      }
    }

    if (result.instrumentation.migrationMoved) {
      migrationPulseCount++;
      migrationColonistsTotal += result.instrumentation.migrationMoved.colonists;
      migrationDiffusionTotal += result.instrumentation.migrationMoved.diffusion;
    }

    trackFoundedColonies(world.systems, world.meta.currentTick, developedAtStart, foundedColonies);
    // The reading needs full tick rows (buildings + government drive the demand weights), so build
    // them only on the pulse that actually has a colony to read — not every tick of the run.
    if (
      monthLength > 0 && world.meta.currentTick % monthLength === 0 &&
      hasColonyAwaitingSample(foundedColonies, world.meta.currentTick)
    ) {
      sampleFoundedColonies(toTickSystems(world), currentMarkets, world.meta.currentTick, foundedColonies);
    }

    if (world.meta.currentTick % SNAPSHOT_INTERVAL === 0) {
      marketSnapshots.push({ tick: world.meta.currentTick, markets: takeMarketSnapshot(currentMarkets) });
      const popSnap = new Map<string, number>();
      for (const s of world.systems) popSnap.set(s.id, s.population);
      populationSnapshots.push(popSnap);
      treasurySnapshots.push(sampleTreasuries(world.meta.currentTick, world.treasuries));
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

  const migrationThroughput: MigrationThroughputSummary = {
    totalColonists: migrationColonistsTotal,
    totalDiffusion: migrationDiffusionTotal,
    pulseCount: migrationPulseCount,
    meanPerPulse:
      migrationPulseCount > 0
        ? (migrationColonistsTotal + migrationDiffusionTotal) / migrationPulseCount
        : 0,
  };

  return {
    config,
    economyScale: ECONOMY_SCALE,
    marketSnapshots,
    marketHealth,
    eventImpacts,
    logisticsActivity: summarizeLogistics(logisticsFlows),
    buildBurstSummary: summarizeBuildBursts(buildCommitments),
    regionOverview,
    label,
    elapsedMs: performance.now() - start,
    finalWorld: world,
    initialPopulationTotal,
    initialBuildingTotal,
    populationSnapshots,
    migrationThroughput,
    foundingStock: summarizeFoundingStock(foundedColonies),
    treasurySummary: summarizeTreasuries(world.treasuries, treasurySnapshots),
    treasurySnapshots,
  };
}
