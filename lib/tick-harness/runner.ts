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
import {
  takeMarketSnapshot, computeMarketHealth, computeKneeBinding, SNAPSHOT_INTERVAL,
  newDemandHuntingAccumulator, sampleDemandHunting, summarizeDemandHunting,
} from "./market-analysis";
import {
  trackEventLifecycles,
  flushActiveEvents,
  computeEventImpacts,
} from "./event-analysis";
import { summarizeLogistics, LOGISTICS_WARMUP_TICKS } from "./logistics-analysis";
import type { LogisticsBudgetTotals, FundingBoundFlagCensus } from "./logistics-analysis";
import {
  summarizeBuildBursts, trackFoundedColonies, sampleFoundedColonies, hasColonyAwaitingSample,
  summarizeFoundingStock, recordFoundingManifest, newFoundingStallTotals, recordFoundingStall,
  newInFlightEstablishTotals, sampleOpenColonies, summarizeFoundingLifecycle, summarizeFounderCohort,
} from "./build-analysis";
import type {
  BuildCommitmentRecord, FoundedColonyRecord, FoundingStagingRecord, FoundingStagingTotals,
} from "./build-analysis";
import { CONSTRUCTION_INTERVAL, CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import {
  sampleTreasuries, summarizeTreasuries, recordSettledCycles, summarizeFoundingEra,
} from "./treasury-analysis";
import type { FactionCycleRecord, TreasurySnapshot } from "./treasury-analysis";
import {
  newCharterCensus, recordCharterCensus, newStagedLedgerCensus, recordStagedLedger,
  summarizeConservation,
} from "./conservation-analysis";
import { computeRoleCoverLevels, computeWorldCohorts, logisticsTargetsByKey, marketRolesByKey } from "./cohort-analysis";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import type { GovernmentType } from "@/lib/types/game";
import type { WorldFlowEvent, WorldMarket } from "@/lib/world/types";
import type {
  HarnessConfig,
  HarnessResults,
  MarketRole,
  MarketSnapshot,
  EventLifecycle,
  RegionOverviewEntry,
  MigrationThroughputSummary,
} from "./types";
import type { TickEvent, TickSystem } from "@/lib/tick/rows";

/**
 * One tick's founding bookkeeping: accumulate this tick's staging draws, THEN sweep for colonies
 * that just developed, so a colony founded on this tick takes its own last slice with it.
 *
 * The two steps are one function because their ORDER is the whole instrument. A colony stages for
 * many cycles while its target is still `controlled`, and the last slice is staged on the very tick
 * the establish completes. Sweep first and that slice lands in the accumulator after the record was
 * built from it, and is never read again — and the loss is silent: every earlier slice still folds,
 * so the readout prints a plausible, slightly small number rather than an obviously dead 0.
 *
 * Exported for the test that pins that composition; `runTickHarness` is its only production caller.
 */
export function foldFoundingTick(
  systems: ReadonlyArray<Pick<TickSystem, "id" | "control">>,
  tick: number,
  developedAtStart: ReadonlySet<string>,
  tracker: Map<string, FoundedColonyRecord>,
  staging: Map<string, FoundingStagingTotals>,
  draws: ReadonlyArray<FoundingStagingRecord>,
): void {
  for (const draw of draws) recordFoundingManifest(staging, draw);
  trackFoundedColonies(systems, tick, developedAtStart, tracker, staging);
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
  // Haul-budget ledger — Σ granted / Σ spent / funding-bound events, accumulated per tick like
  // the flow log (transient instrumentation), but only from LOGISTICS_WARMUP_TICKS onward:
  // logistics is colonisation-gated, so earlier cycles grant budget nothing can spend and would
  // dilute budgetSpentFrac's denominator (~46% of a 1000-tick run predates the first transfer).
  const logisticsBudgetTotals: LogisticsBudgetTotals = { total: 0, spent: 0, fundingBoundEvents: 0 };
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
  // What each in-flight colony has staged from its founder so far, keyed by TARGET system. Kept
  // apart from `foundedColonies` because a colony stages for cycles before it is one: keyed by the
  // tracker, every draw but the last would be dropped as belonging to an unknown system.
  const foundingStaging = new Map<string, FoundingStagingTotals>();
  // The founding lifecycle, all three parts accumulated per tick because none survives the tick that
  // produced it: the first cycle each colony was seen committed (its establish leaves the open queue
  // the cycle it lands), the concurrent in-flight census, and what held each colony back.
  const colonyCommitments = new Map<string, number>();
  const inFlightEstablishes = newInFlightEstablishTotals();
  const foundingStalls = newFoundingStallTotals();
  // Every system that has SUCCESSFULLY STAGED A DRAW for a founding — the founder cohort the
  // end-of-run production and disuse reads are split by. A source with nothing to spare stages
  // nothing, emits no manifest, and so is not one of these however many colonies name it.
  const founderSystemIds = new Set<string>();
  // One record per faction per settlement, taken as each lands: a settlement is overwritten by the
  // next one, so the founding-era money bars cannot be reconstructed from the final world.
  const factionCycles: FactionCycleRecord[] = [];
  const settlementTickByFaction = new Map<string, number>();
  // The conservation identities' two run-long collectors. Charters are censused every tick, not every
  // construction cycle: a charter is paid in the same processor pass that mints its project, so the
  // unpaid state is usually never visible and only a per-tick read bounds how long a revert could
  // hide. The opening balances are taken before the first tick because the first settlement's own
  // opening balance exists nowhere else once that settlement has overwritten it.
  const charterCensus = newCharterCensus();
  const startingBalances = new Map(world.treasuries.map((t) => [t.factionId, t.balance]));
  // The staged-goods comparison is sampled per tick because the END of a run is the one moment it
  // has nothing to look at: by the equilibrium horizon every establish has completed and the queue
  // holds no colonies, so a run-end read compares 0 against 0 and passes vacuously.
  const stagedLedgerCensus = newStagedLedgerCensus();
  const demandHunting = newDemandHuntingAccumulator();
  const cycleLength = config.cadence?.cycle ?? CYCLE_LENGTH;
  const constructionInterval = config.cadence?.construction ?? CONSTRUCTION_INTERVAL;

  const initialPopulationTotal = world.systems.reduce((sum, s) => sum + s.population, 0);
  const initialBuildingTotal = tickSystemsAtStart.reduce(
    (sum, s) => sum + Object.values(s.buildings).reduce((a, c) => a + Math.max(0, c), 0),
    0,
  );

  // Kept in sync with `world` every tick — reused as both this tick's post-tick
  // snapshot and next tick's pre-tick snapshot, so a tick's market rows are held
  // across the loop boundary rather than re-read per use.
  let currentMarkets: WorldMarket[] = world.markets;

  // The two per-run override channels, both dev/measurement surfaces: the cadence, and the
  // third-arm pin for the draw figure's brake. Absent both, the live loop's own defaults run.
  const tickOpts =
    config.cadence || config.drawBrakeCeiling
      ? { cadence: config.cadence, drawBrakeCeiling: config.drawBrakeCeiling }
      : undefined;

  for (let t = 0; t < config.tickCount; t++) {
    const preTickMarkets = currentMarkets;

    const result = await runWorldTick(world, tickOpts);
    world = result.world;
    currentMarkets = result.markets;

    for (const f of world.flowEvents) {
      if (f.tick === world.meta.currentTick) logisticsFlows.push(f);
    }

    if (result.instrumentation.logisticsBudget && world.meta.currentTick >= LOGISTICS_WARMUP_TICKS) {
      for (const b of result.instrumentation.logisticsBudget.values()) {
        logisticsBudgetTotals.total += b.total;
        logisticsBudgetTotals.spent += b.spent;
        logisticsBudgetTotals.fundingBoundEvents += b.fundingBoundCount;
      }
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

    for (const draw of result.instrumentation.foundingManifests ?? []) {
      founderSystemIds.add(draw.sourceSystemId);
    }
    // The event board is read at the tick the shortfall happened: a founder under an active event is
    // sparing less for a reason the design accepts, and by run end that event is long gone.
    const stalls = result.instrumentation.foundingStalls ?? [];
    if (stalls.length > 0) {
      const systemsUnderEvent = new Set<string>();
      for (const e of world.events) {
        if (e.systemId !== null) systemsUnderEvent.add(e.systemId);
      }
      for (const stall of stalls) {
        recordFoundingStall(foundingStalls, stall, systemsUnderEvent.has(stall.sourceSystemId));
      }
    }
    // Sampled on the construction cycle the queue was just resolved on, so each in-flight colony is
    // counted once per cycle rather than once per tick it happens to still be open.
    if (constructionInterval > 0 && world.meta.currentTick % constructionInterval === 0) {
      sampleOpenColonies(
        world.constructionProjects, world.meta.currentTick, colonyCommitments, inFlightEstablishes,
      );
    }
    recordCharterCensus(world.constructionProjects, charterCensus);
    recordSettledCycles(world.treasuries, settlementTickByFaction, factionCycles);

    foldFoundingTick(
      world.systems, world.meta.currentTick, developedAtStart, foundedColonies, foundingStaging,
      result.instrumentation.foundingManifests ?? [],
    );
    // After the fold, never before it: this tick's last draw is staged on the very tick its
    // establish completes, and comparing a ledger against an accumulator missing that draw would
    // report a conserved move as lost goods.
    recordStagedLedger(world.constructionProjects, foundingStaging, stagedLedgerCensus);
    // The colony opening sample needs full tick rows (buildings + government drive the demand
    // weights). Due colonies are rare, so the rows are built only on the ticks that need them.
    const colonyDue =
      cycleLength > 0 && world.meta.currentTick % cycleLength === 0 &&
      hasColonyAwaitingSample(foundedColonies, world.meta.currentTick);
    const tickSystems = colonyDue ? toTickSystems(world) : undefined;

    // The flip half of the hunting reading is a per-cycle observation; the churn half comes off
    // the whole flow log at the end.
    if (cycleLength > 0 && world.meta.currentTick % cycleLength === 0) {
      sampleDemandHunting(demandHunting, currentMarkets);
    }
    if (tickSystems && colonyDue) {
      sampleFoundedColonies(tickSystems, currentMarkets, world.meta.currentTick, foundedColonies);
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
  // The live partition — what this arm actually classified — published so a later arm can pin to
  // it. Taken before the pin is applied below, so a pinned run still reports its own membership
  // and the drift between arms stays visible.
  const roleInfoByKey = marketRolesByKey(finalTickSystems, currentMarkets);
  const marketRoles: Record<string, MarketRole> = {};
  for (const [key, info] of roleInfoByKey) {
    marketRoles[key] = info.role;
  }
  const roleCoverLevels = computeRoleCoverLevels(
    finalTickSystems,
    currentMarkets,
    config.pinnedRoles ? new Map(Object.entries(config.pinnedRoles)) : undefined,
    roleInfoByKey,
  );
  const worldCohorts = computeWorldCohorts(
    finalTickSystems, currentMarkets, homeworldIds, STRIKE_PARAMS.threshold, world.events,
  );
  const kneeBinding = computeKneeBinding(finalTickSystems, currentMarkets);

  const systemNames = new Map(world.systems.map((s) => [s.id, s.name]));
  const eventImpacts = computeEventImpacts(completedEvents, systemNames);

  // Funding-bound flag census at run end, over developed-system markets only — undeveloped
  // systems never enter the logistics assessment, so counting them would dilute the rate.
  const developedIds = new Set(
    finalTickSystems.filter((s) => s.control === "developed").map((s) => s.id),
  );
  const developedMarkets = currentMarkets.filter((m) => developedIds.has(m.systemId));
  const fundingBoundFlags: FundingBoundFlagCensus = {
    flagged: developedMarkets.filter((m) => m.logisticsFundingBound ?? false).length,
    marketCount: developedMarkets.length,
  };

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
    kneeBinding,
    marketRoles,
    demandHunting: summarizeDemandHunting(demandHunting, logisticsFlows),
    worldCohorts,
    eventImpacts,
    logisticsActivity: summarizeLogistics(logisticsFlows, logisticsBudgetTotals, fundingBoundFlags),
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
    foundingLifecycle: summarizeFoundingLifecycle(
      foundedColonies, colonyCommitments, inFlightEstablishes, foundingStalls, constructionInterval,
    ),
    founderCohort: summarizeFounderCohort(finalTickSystems, currentMarkets, founderSystemIds),
    treasurySummary: summarizeTreasuries(world.treasuries, treasurySnapshots),
    foundingEra: summarizeFoundingEra(factionCycles),
    treasurySnapshots,
    conservation: summarizeConservation({
      charters: charterCensus,
      factionCycles,
      startingBalances,
      stagedLedger: stagedLedgerCensus,
    }),
  };
}
