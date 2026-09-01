/**
 * Calibration harness runner — generate a world, loop `runWorldTick`,
 * snapshot/analyse. A thin wrapper over the shared tick pipeline
 * (`lib/world/tick.ts`): `runTickHarness` exists to drive the real engine for
 * calibration health checks, not to simulate player trading. There is no bot
 * layer; it runs the same code constants the live game does, except for an
 * optional per-run cadence override (a dev/test surface) threaded from config.
 */

import { generateWorld } from "@/lib/world/gen";
import { runWorldTick, toTickSystems, toTickConnections } from "@/lib/world/tick";
import {
  takeMarketSnapshot, computeMarketHealth, computeKneeBinding, SNAPSHOT_INTERVAL,
  newDemandHuntingAccumulator, sampleDemandHunting, summariseDemandHunting,
} from "./market-analysis";
import {
  trackEventLifecycles,
  flushActiveEvents,
  computeEventImpacts,
} from "./event-analysis";
import { summariseLogistics, fundingBoundCensus, LOGISTICS_WARMUP_TICKS } from "./logistics-analysis";
import type { LogisticsBudgetTotals } from "./logistics-analysis";
import { summariseGeography } from "./geography-analysis";
import {
  summariseBuildBursts, trackFoundedColonies, sampleFoundedColonies, hasColonyAwaitingSample,
  summariseFoundingStock, recordFoundingManifest, newFoundingStallTotals, recordFoundingStall,
  newInFlightEstablishTotals, sampleOpenColonies, summariseFoundingLifecycle, summariseFounderCohort,
  newFoundingTrajectoryTotals, sampleFoundingTrajectory, hasColonyInTrajectoryWindow,
  summariseFoundingTrajectory, summariseTierZeroIdle,
} from "./build-analysis";
import type {
  BuildCommitmentRecord, FoundedColonyRecord, FoundingStagingRecord, FoundingStagingTotals,
  FoundingTrajectoryTotals,
} from "./build-analysis";
import { CONSTRUCTION_INTERVAL, CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import {
  sampleTreasuries, summariseTreasuries, recordSettledCycles, summariseFoundingEra,
} from "./treasury-analysis";
import type { FactionCycleRecord, TreasurySnapshot } from "./treasury-analysis";
import {
  newCharterCensus, recordCharterCensus, newStagedLedgerCensus, recordStagedLedger,
  summariseConservation,
} from "./conservation-analysis";
import {
  computeRoleCoverLevels, computeWorldCohorts, logisticsTargetsByKey, marketRolesByKey,
  summariseEpisodeCostsByCohort, summariseRatchetCheck,
} from "./cohort-analysis";
import {
  newEpisodeCostTotals, recordEpisodeCosts, computeTrailingProvisionVariance,
  RATCHET_TRAILING_WINDOW, sampleProvisionBySystem,
} from "./population-analysis";
import type { EpisodeCostTotals } from "./population-analysis";
import { STRIKE_PARAMS } from "@/lib/constants/population";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import type { GovernmentType } from "@/lib/types/game";
import type { WorldFlowEvent, WorldMarket, WorldRegion } from "@/lib/world/types";
import type {
  HarnessConfig,
  HarnessResults,
  MarketRole,
  MarketSnapshot,
  EventLifecycle,
  RegionOverviewEntry,
  MigrationThroughputSummary,
  StrikeSuppressionSummary,
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

/**
 * Region overview: each region's system count and modal government type, ties broken
 * alphabetically, an empty region (no systems at all) keeping the "federation" default rather
 * than ranking nothing. Exported (and pure — no `generateWorld` dependency) so the empty-region,
 * tie-break and tie-direction branches can be proven on a hand-built input: `generateWorld` itself
 * cannot produce a genuinely empty region at any system count large enough to also place its
 * required faction homeworlds (spec §5's per-cluster placement guarantee means a system count
 * that large already covers every cluster), so the branch would otherwise have no live fixture at
 * all. `runTickHarness` is its only production caller.
 */
export function computeRegionOverview(
  regions: ReadonlyArray<Pick<WorldRegion, "id" | "name">>,
  systemsByRegion: ReadonlyMap<string, GovernmentType[]>,
): RegionOverviewEntry[] {
  return regions.map((r) => {
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
}

/** Mirrors event-analysis.ts's (unexported) ActiveEventRecord shape. */
interface ActiveEventRecord {
  type: TickEvent["type"];
  systemId: string | null;
  startTick: number;
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
  const regionOverview = computeRegionOverview(world.regions, systemsByRegion);

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
  // Per-system colonist-delivery inflow, accumulated across the whole run — the pump watch's
  // numerator, folded by world cohort at the end via computeWorldCohorts. Transient instrumentation
  // (`runWorldTick().instrumentation`), so like migrationMoved it is accumulated per tick.
  const colonistDeliveryTotals = new Map<string, number>();
  // Whole-run abandonment counts by cause (famine-collapse vs decline-to-empty), folded from
  // `abandonedSystemsByCause` each cycle. Not cohorted: an abandoned system reverts to unclaimed
  // this same cycle (`applyAbandonments`), so it never appears in a settled-only cohort read again.
  let abandonedFamineCollapse = 0;
  let abandonedDeclineToEmpty = 0;
  // Whole-run strike-suppression resolution (directed-build) — Σ suppressed / Σ eligible over every
  // cycle's per-(system,good) resolution. Transient instrumentation, accumulated per tick like the
  // migration totals above; read as a rate over eligible, never as the raw counts (the spec's
  // hazard-6: the raw count grows with the galaxy).
  let strikeSuppressedTotal = 0;
  let strikeEligibleTotal = 0;
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
  // The staged-ledger identity's own copy of the same draws. Separate because it is pruned per
  // founding (`recordStagedLedger`) while the map above must accumulate for a system's whole life —
  // it is what the founding cost reads fold into when a colony is first seen developed.
  const stagedLedgerStaging = new Map<string, FoundingStagingTotals>();
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
  // Episode costs (adaptive-expectation gate): per-system running totals of the two
  // TickInstrumentation counters, folded into cohort incidence at the end of the run.
  const episodeCostTotals: EpisodeCostTotals = newEpisodeCostTotals();
  // Founding trajectory: repeated Provision/unrest readings per tracked colony, bucketed by age
  // since founding — see build-analysis.ts's founding-trajectory section.
  const foundingTrajectoryTotals: FoundingTrajectoryTotals = newFoundingTrajectoryTotals();
  // The ratchet check's raw material: per-settled-system Provision sampled at the same cadence as
  // populationSnapshots, so computeTrailingProvisionVariance can read a trailing window off it at
  // the end of the run.
  const provisionSnapshots: Array<Map<string, number>> = [];

  const initialPopulationTotal = world.systems.reduce((sum, s) => sum + s.population, 0);
  // True tick-0 population per system — netGrowthPct's start denominator. Captured here rather
  // than read off `populationSnapshots` (whose first entry lands at SNAPSHOT_INTERVAL, after the
  // loop has already run 50 ticks): the same window `initialPopulationTotal` above is captured
  // over, so the cohorted reading and the galaxy-wide growthPct measure the identical start.
  const startPopulationBySystem = new Map(world.systems.map((s) => [s.id, s.population]));
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

    if (result.instrumentation.colonistDeliveryBySystem) {
      for (const [systemId, amount] of result.instrumentation.colonistDeliveryBySystem) {
        colonistDeliveryTotals.set(systemId, (colonistDeliveryTotals.get(systemId) ?? 0) + amount);
      }
    }

    if (result.instrumentation.abandonedSystemsByCause) {
      for (const cause of result.instrumentation.abandonedSystemsByCause.values()) {
        if (cause === "famine-collapse") abandonedFamineCollapse++;
        else abandonedDeclineToEmpty++;
      }
    }

    if (result.instrumentation.strikeSuppressedProposals) {
      strikeSuppressedTotal += result.instrumentation.strikeSuppressedProposals.suppressed;
      strikeEligibleTotal += result.instrumentation.strikeSuppressedProposals.eligible;
    }

    // Episode costs: fold this tick's per-system teardown/overshoot-death counters into the
    // running totals. Either or both may be absent (the common case — see the instrumentation's
    // own sparse-map contract), which recordEpisodeCosts is a no-op for.
    recordEpisodeCosts(
      episodeCostTotals,
      result.instrumentation.teardownLevelsBySystem,
      result.instrumentation.overshootDeathBySystem,
    );

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

    const foundingManifests = result.instrumentation.foundingManifests ?? [];
    foldFoundingTick(
      world.systems, world.meta.currentTick, developedAtStart, foundedColonies, foundingStaging,
      foundingManifests,
    );
    for (const draw of foundingManifests) recordFoundingManifest(stagedLedgerStaging, draw);
    // After the fold, never before it: this tick's last draw is staged on the very tick its
    // establish completes, and comparing a ledger against an accumulator missing that draw would
    // report a conserved move as lost goods.
    recordStagedLedger(world.constructionProjects, stagedLedgerStaging, stagedLedgerCensus);
    // The colony opening sample needs full tick rows (buildings + government drive the demand
    // weights). Due colonies are rare, so the rows are built only on the ticks that need them.
    // trajectoryDue extends this to the whole founding-trajectory window (~60 cycles), not just
    // the single opening read, for the SAME reason — full rows only when something is due.
    const colonyDue =
      cycleLength > 0 && world.meta.currentTick % cycleLength === 0 &&
      hasColonyAwaitingSample(foundedColonies, world.meta.currentTick);
    const trajectoryDue =
      cycleLength > 0 && world.meta.currentTick % cycleLength === 0 &&
      hasColonyInTrajectoryWindow(foundedColonies, world.meta.currentTick, cycleLength);
    const tickSystems = colonyDue || trajectoryDue ? toTickSystems(world) : undefined;

    // The flip half of the hunting reading is a per-cycle observation; the churn half comes off
    // the whole flow log at the end.
    if (cycleLength > 0 && world.meta.currentTick % cycleLength === 0) {
      sampleDemandHunting(demandHunting, currentMarkets);
    }
    if (tickSystems && colonyDue) {
      sampleFoundedColonies(tickSystems, currentMarkets, world.meta.currentTick, foundedColonies);
    }
    if (tickSystems && trajectoryDue) {
      sampleFoundingTrajectory(
        tickSystems, currentMarkets, world.meta.currentTick, cycleLength, foundedColonies,
        foundingTrajectoryTotals,
      );
    }

    if (world.meta.currentTick % SNAPSHOT_INTERVAL === 0) {
      marketSnapshots.push({ tick: world.meta.currentTick, markets: takeMarketSnapshot(currentMarkets) });
      const popSnap = new Map<string, number>();
      for (const s of world.systems) popSnap.set(s.id, s.population);
      populationSnapshots.push(popSnap);
      treasurySnapshots.push(sampleTreasuries(world.meta.currentTick, world.treasuries));
      // The ratchet check's raw material — reuses the same full-row build the founding trajectory
      // needs, when one was already built for this tick, rather than paying for a second pass.
      provisionSnapshots.push(sampleProvisionBySystem(tickSystems ?? toTickSystems(world), currentMarkets));
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
    startPopulationBySystem, colonistDeliveryTotals,
  );
  const kneeBinding = computeKneeBinding(finalTickSystems, currentMarkets);

  const systemNames = new Map(world.systems.map((s) => [s.id, s.name]));
  const eventImpacts = computeEventImpacts(completedEvents, systemNames);

  const fundingBoundFlags = fundingBoundCensus(finalTickSystems, currentMarkets);

  const migrationThroughput: MigrationThroughputSummary = {
    totalColonists: migrationColonistsTotal,
    totalDiffusion: migrationDiffusionTotal,
    cycleCount: migrationCycleCount,
    meanPerCycle:
      migrationCycleCount > 0
        ? (migrationColonistsTotal + migrationDiffusionTotal) / migrationCycleCount
        : 0,
  };

  const strikeSuppression: StrikeSuppressionSummary = {
    suppressed: strikeSuppressedTotal,
    eligible: strikeEligibleTotal,
    ratePerEligible: strikeEligibleTotal > 0 ? strikeSuppressedTotal / strikeEligibleTotal : 0,
  };

  const geography = summariseGeography(
    finalTickSystems, toTickConnections(world), world.factions, logisticsFlows, colonistDeliveryTotals,
  );

  const episodeCosts = summariseEpisodeCostsByCohort(episodeCostTotals, finalTickSystems, homeworldIds);
  const foundingTrajectory = summariseFoundingTrajectory(foundingTrajectoryTotals);
  const provisionVarianceBySystem = computeTrailingProvisionVariance(provisionSnapshots, RATCHET_TRAILING_WINDOW);
  const provisionRatchet = summariseRatchetCheck(
    provisionVarianceBySystem, RATCHET_TRAILING_WINDOW, finalTickSystems, currentMarkets, homeworldIds,
    world.events,
  );

  return {
    config,
    economyScale: ECONOMY_SCALE,
    marketSnapshots,
    marketHealth,
    roleCoverLevels,
    kneeBinding,
    marketRoles,
    demandHunting: summariseDemandHunting(demandHunting, logisticsFlows),
    worldCohorts,
    abandonmentByCause: {
      famineCollapse: abandonedFamineCollapse,
      declineToEmpty: abandonedDeclineToEmpty,
      total: abandonedFamineCollapse + abandonedDeclineToEmpty,
    },
    eventImpacts,
    logisticsActivity: summariseLogistics(logisticsFlows, logisticsBudgetTotals, fundingBoundFlags),
    buildBurstSummary: summariseBuildBursts(buildCommitments),
    regionOverview,
    label,
    elapsedMs: performance.now() - start,
    finalWorld: world,
    initialPopulationTotal,
    initialBuildingTotal,
    populationSnapshots,
    migrationThroughput,
    strikeSuppression,
    foundingStock: summariseFoundingStock(foundedColonies),
    foundingLifecycle: summariseFoundingLifecycle(
      foundedColonies, colonyCommitments, inFlightEstablishes, foundingStalls, constructionInterval,
    ),
    founderCohort: summariseFounderCohort(finalTickSystems, currentMarkets, founderSystemIds),
    treasurySummary: summariseTreasuries(world.treasuries, treasurySnapshots),
    foundingEra: summariseFoundingEra(factionCycles),
    treasurySnapshots,
    conservation: summariseConservation({
      charters: charterCensus,
      factionCycles,
      startingBalances,
      stagedLedger: stagedLedgerCensus,
    }),
    episodeCosts,
    foundingTrajectory,
    provisionRatchet,
    tierZeroIdle: summariseTierZeroIdle(finalTickSystems, homeworldIds),
    geography,
  };
}
