/**
 * A minimal-but-fully-typed `HarnessResults` fixture, shared by tests that need the whole shape
 * (a function or report-formatter that takes the full `HarnessResults`) but only exercise a
 * projection of it. Extracted here once it had a second call site — `experiment.test.ts`'s
 * `buildExperimentResult` tests and `scripts/__tests__/simulate.test.ts`'s `formatTable` test —
 * per AGENTS.md's "extract on the second occurrence".
 */
import { generateWorld } from "@/lib/world/gen";
import { newFoundingStallTotals } from "../build-analysis";
import { summariseFoundingEra } from "../treasury-analysis";
import {
  newCharterCensus, newStagedLedgerCensus, newDispatchDrainCensus, summariseConservation,
} from "../conservation-analysis";
import type { HarnessResults } from "../types";

export function minimalHarnessResults(): HarnessResults {
  return {
    config: { systemCount: 60, seed: 1, tickCount: 1 },
    economyScale: 100,
    marketSnapshots: [],
    marketHealth: {
      priceDispersion: [], stockDrift: [], stockPins: [],
      priceLevels: { median: 1, p10: 1, p90: 1, cheapFrac: 0, nearFrac: 1, expensiveFrac: 0 },
      coverLevels: [],
    },
    roleCoverLevels: [],
    kneeBinding: [],
    marketRoles: {},
    demandHunting: { flipRate: 0, haulChurnRatio: 0 },
    worldCohorts: [],
    abandonmentByCause: { famineCollapse: 0, declineToEmpty: 0, total: 0 },
    eventImpacts: [],
    logisticsActivity: {
      transferCount: 0, activeTicks: 0, totalQuantity: 0, meanTransferSize: 0,
      participatingSystems: 0, byGood: [], budgetSpentFrac: 0, fundingBoundEvents: 0,
      fundingBoundFlaggedMarkets: 0, fundingBoundMarketCount: 0,
      fundingBoundFlagSetRate: 0, flowRowsPerReferenceCycle: 0,
    },
    buildBurstSummary: { byGood: [], globalMax: 0, worstGood: null, worstTick: null },
    regionOverview: [],
    elapsedMs: 1,
    finalWorld: generateWorld({ systemCount: 60, seed: 1 }),
    initialPopulationTotal: 0,
    initialBuildingTotal: 0,
    populationSnapshots: [],
    migrationThroughput: { totalColonists: 0, totalDiffusion: 0, cycleCount: 0, meanPerCycle: 0 },
    strikeSuppression: { suppressed: 0, eligible: 0, ratePerEligible: 0 },
    foundingStock: {
      foundedCount: 0, sampledCount: 0, meanOpeningSatisfaction: 0,
      meanOpeningShortfall: 0, meanOpeningProvision: null, p10OpeningProvision: null,
      minOpeningProvision: null,
      openingDeprivedCount: 0,
      meanManifestTonnage: 0, meanFoundingMoneyCost: 0, medianFounderCoverAfter: null,
      cadenceMarkShare: 0.8, cadenceMarkTick: null,
    },
    foundingLifecycle: {
      sampledCount: 0, unobservedCount: 0, meanCycles: 0, medianCycles: 0, maxCycles: 0,
      inFlight: { meanPerCycle: 0, max: 0, maxTick: null, sampledCycles: 0 },
      stalls: newFoundingStallTotals(),
    },
    founderCohort: {
      founder: {
        systemCount: 0, meanRealisedProduction: 0, productionSuppressedShare: 0,
        producingMarkets: 0, meanIdleTypes: 0, idleSystemShare: 0,
      },
      other: {
        systemCount: 0, meanRealisedProduction: 0, productionSuppressedShare: 0,
        producingMarkets: 0, meanIdleTypes: 0, idleSystemShare: 0,
      },
    },
    treasurySummary: {
      factionCount: 0, meanBalance: 0, minBalance: 0, maxBalance: 0,
      headsShare: 0, productionShare: 0,
      fundedMeans: { maintenance: 0, logistics: 0, construction: 0 },
      invalidRows: 0, firstShortfallTick: null,
    },
    foundingEra: summariseFoundingEra([]),
    treasurySnapshots: [],
    conservation: summariseConservation({
      charters: newCharterCensus(),
      factionCycles: [],
      startingBalances: new Map(),
      stagedLedger: newStagedLedgerCensus(),
      dispatchDrain: newDispatchDrainCensus(),
    }),
    episodeCosts: { totalTeardownLevels: 0, totalOvershootDeaths: 0, byCohort: [] },
    foundingTrajectory: { buckets: [] },
    provisionRatchet: { window: 6, buckets: [] },
    tierZeroIdle: {
      homeworld: { systemCount: 0, idleLevels: 0, systemsWithIdleTier0: 0 },
      colony: { systemCount: 0, idleLevels: 0, systemsWithIdleTier0: 0 },
    },
    geography: {
      topDecileShare: 0,
      topDecileShareByFaction: [],
      fuelP90P10All: 0,
      fuelP90P10Trafficked: 0,
      crossFactionLaneCount: 0,
      beyondCrossingCohort: [
        { cohort: "interior", n: 0, meanMigrantInflow: 0, meanPopulationTrend: 0 },
        { cohort: "beyond-crossing", n: 0, meanMigrantInflow: 0, meanPopulationTrend: 0 },
      ],
      unreachableHaulCount: 0,
      unreachableHaulVolume: 0,
      unreachableHaulVolumeShare: 0,
      foreignTransitHaulCount: 0,
      foreignTransitHaulVolume: 0,
      foreignTransitHaulVolumeShare: 0,
    },
    laneMetrics: {
      utilisation: { p50: 0, p90: 0, max: 0, saturatedShare: 0 },
      topDecileShare: 0,
      inTransitVolume: { mean: 0, max: 0, topLanes: [] },
      blockedVolume: { total: 0, topLanes: [] },
      queuedVsRealised: { laneCount: 0, meanQueuedLevels: 0, meanUtilisation: 0 },
      foreignTransitShare: 0,
      contentionShortfallByFaction: [],
      overshootVolume: 0,
      budgetSkipped: 0,
      survivalStockFalling: { count: 0, share: 0 },
    },
    survivalSpellDistribution: { n: 0, median: 0, p90: 0, singleRunShare: 0 },
    stageTiming: {
      tickMsMedian: 0, directedLogisticsMsMedian: 0, goodsArrivalsMsMedian: 0,
      directedLogisticsShare: 0, goodsArrivalsShare: 0,
    },
  };
}
