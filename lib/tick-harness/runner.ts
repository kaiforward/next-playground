/**
 * Calibration harness runner — generate a world, loop `runWorldTick`,
 * snapshot/analyze. A thin wrapper over the shared tick pipeline
 * (`lib/world/tick.ts`): `runTickHarness` exists to drive the real engine for
 * calibration health checks, not to simulate player trading. There is no bot
 * layer; it runs the same code constants the live game does, except for an
 * optional per-run cadence override (a dev/test surface) threaded from config.
 */

import { generateWorld } from "@/lib/world/gen";
import { runWorldTick, toTickSystems, marketRowsBySystem } from "@/lib/world/tick";
import {
  takeMarketSnapshot, computeMarketHealth, SNAPSHOT_INTERVAL,
  newDemandHuntingAccumulator, sampleDemandHunting, summarizeDemandHunting,
} from "./market-analysis";
import {
  trackEventLifecycles,
  flushActiveEvents,
  computeEventImpacts,
} from "./event-analysis";
import { summarizeLogistics } from "./logistics-analysis";
import {
  summarizeBuildBursts, trackFoundedColonies, sampleFoundedColonies, hasColonyAwaitingSample,
  summarizeFoundingStock, recordFoundingManifest,
} from "./build-analysis";
import type { BuildCommitmentRecord, FoundedColonyRecord } from "./build-analysis";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { sampleTreasuries, summarizeTreasuries } from "./treasury-analysis";
import type { TreasurySnapshot } from "./treasury-analysis";
import { computeRoleCoverLevels, computeWorldCohorts, logisticsTargetsByKey } from "./cohort-analysis";
import { STRIKE_PARAMS } from "@/lib/constants/population";
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
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";
import type { TickEvent, TickSystem } from "@/lib/tick/rows";

/**
 * The founder's own remaining cover on the BINDING good of a manifest it just shipped — the
 * minimum, across the manifest's goods, of post-manifest stock over that good's donor floor.
 * Below 1 means founding drew the founder under the floor it is meant to keep for itself, which
 * is the reading the manifest cap's use-figure denominator can move.
 */
function founderCoverAfter(
  systems: TickSystem[],
  rowsBySystem: Map<string, MarketRowForLogistics[]>,
  sourceSystemId: string,
  goodIds: ReadonlyArray<string>,
): number {
  const source = systems.find((s) => s.id === sourceSystemId);
  const rows = rowsBySystem.get(sourceSystemId);
  if (!source || !rows || goodIds.length === 0) return 0;
  const shipped = new Set(goodIds);
  let binding = Infinity;
  const states = toGoodMarketStates({
    buildings: source.buildings, population: source.population, yields: source.yields, markets: rows,
  });
  for (const state of states) {
    if (!shipped.has(state.goodId) || state.donorReserve <= 0) continue;
    binding = Math.min(binding, state.stock / state.donorReserve);
  }
  // No measurable good on the manifest (every reserve zero) reads 0 — it shipped from a
  // founder with no floor to be drawn under.
  return Number.isFinite(binding) ? binding : 0;
}

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
  // Whole-run directed-build commitments, one record per (tick, good) this cycle committed new
  // autonomic levels for. Transient instrumentation (`runWorldTick().instrumentation`) — never
  // persisted in `World` — so, like flowEvents, it must be captured as each tick happens.
  const buildCommitments: BuildCommitmentRecord[] = [];
  // Whole-run migration throughput — colonist-delivery and edge-diffusion totals, plus the count
  // of cycles that resolved (the per-cycle mean's denominator). Transient instrumentation
  // (`runWorldTick().instrumentation`), so like buildCommitments it is accumulated per tick.
  let migrationCycleCount = 0;
  let migrationColonistsTotal = 0;
  let migrationDiffusionTotal = 0;
  const activeEventTracker = new Map<string, ActiveEventRecord>();
  const completedEvents: EventLifecycle[] = [];
  // Colonies founded in play, sampled at their first assessed cycle. Every system already developed
  // at tick 0 is world-gen's, not the colonisation loop's, so only later arrivals are tracked.
  const developedAtStart = new Set(
    tickSystemsAtStart.filter((s) => s.control === "developed").map((s) => s.id),
  );
  const foundedColonies = new Map<string, FoundedColonyRecord>();
  const demandHunting = newDemandHuntingAccumulator();
  const cycleLength = config.cadence?.cycle ?? CYCLE_LENGTH;

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
      migrationCycleCount++;
      migrationColonistsTotal += result.instrumentation.migrationMoved.colonists;
      migrationDiffusionTotal += result.instrumentation.migrationMoved.diffusion;
    }

    trackFoundedColonies(world.systems, world.meta.currentTick, developedAtStart, foundedColonies);
    // What the founding cost its founder, read at the founding tick — the founder's stock still
    // reflects this manifest and no other. Foundings are rare, so the founder's market state is
    // rebuilt only on the ticks that actually have one.
    const manifests = result.instrumentation.foundingManifests ?? [];
    if (manifests.length > 0) {
      const manifestSystems = toTickSystems(world);
      const manifestRows = marketRowsBySystem(currentMarkets);
      for (const manifest of manifests) {
        recordFoundingManifest(
          foundedColonies,
          manifest.systemId,
          manifest.tonnage,
          founderCoverAfter(manifestSystems, manifestRows, manifest.sourceSystemId, manifest.goodIds),
        );
      }
    }

    // The flip half of the hunting reading is a per-cycle observation; the churn half comes off
    // the whole flow log at the end.
    if (cycleLength > 0 && world.meta.currentTick % cycleLength === 0) {
      sampleDemandHunting(demandHunting, currentMarkets);
    }
    // The reading needs full tick rows (buildings + government drive the demand weights), so build
    // them only on the cycle that actually has a colony to read — not every tick of the run.
    if (
      cycleLength > 0 && world.meta.currentTick % cycleLength === 0 &&
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

  // Cohorted reads, from the final world only — no per-tick tracking. Reuses the tick rows
  // the report already builds rather than walking the world a second time.
  const finalTickSystems = toTickSystems(world);

  // The deficit share is measured against the warehousing target, which needs the systems'
  // real demand — a market row carries only the MIN_DEMAND-floored rate.
  const marketHealth = computeMarketHealth(
    currentMarkets,
    logisticsTargetsByKey(finalTickSystems, currentMarkets),
  );

  const homeworldIds = new Set(world.factions.map((f) => f.homeworldId));
  const roleCoverLevels = computeRoleCoverLevels(finalTickSystems, currentMarkets);
  const worldCohorts = computeWorldCohorts(
    finalTickSystems, currentMarkets, homeworldIds, STRIKE_PARAMS.threshold, world.events,
  );

  const systemNames = new Map(world.systems.map((s) => [s.id, s.name]));
  const eventImpacts = computeEventImpacts(completedEvents, systemNames);

  const migrationThroughput: MigrationThroughputSummary = {
    totalColonists: migrationColonistsTotal,
    totalDiffusion: migrationDiffusionTotal,
    cycleCount: migrationCycleCount,
    meanPerCycle:
      migrationCycleCount > 0
        ? (migrationColonistsTotal + migrationDiffusionTotal) / migrationCycleCount
        : 0,
  };

  return {
    config,
    economyScale: ECONOMY_SCALE,
    marketSnapshots,
    marketHealth,
    roleCoverLevels,
    demandHunting: summarizeDemandHunting(demandHunting, logisticsFlows),
    worldCohorts,
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
