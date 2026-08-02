import { describe, it, expect } from "vitest";
import {
  ExperimentConfigSchema,
  experimentToHarnessConfig,
  buildExperimentResult,
} from "../experiment";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import { generateWorld } from "@/lib/world/gen";
import type { HarnessResults } from "../types";

describe("ExperimentConfig", () => {
  describe("ExperimentConfigSchema", () => {
    it("accepts an empty config, defaulting seed/ticks/systemCount", () => {
      const result = ExperimentConfigSchema.safeParse({});
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.seed).toBe(42);
      expect(result.data.ticks).toBe(500);
      expect(result.data.systemCount).toBe(DEFAULT_SYSTEM_COUNT);
    });

    it("accepts a full config with label/seed/ticks/systemCount overridden", () => {
      const result = ExperimentConfigSchema.safeParse({
        label: "test-experiment",
        seed: 99,
        ticks: 200,
        systemCount: 120,
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.label).toBe("test-experiment");
      expect(result.data.seed).toBe(99);
      expect(result.data.ticks).toBe(200);
      expect(result.data.systemCount).toBe(120);
    });

    it("rejects negative ticks", () => {
      const result = ExperimentConfigSchema.safeParse({ ticks: -1 });
      expect(result.success).toBe(false);
    });

    it("rejects a systemCount below 1", () => {
      const result = ExperimentConfigSchema.safeParse({ systemCount: 0 });
      expect(result.success).toBe(false);
    });

    it("accepts a cadence override", () => {
      const result = ExperimentConfigSchema.safeParse({
        cadence: { cycle: 12, construction: 24, logistics: 48 },
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.cadence).toEqual({ cycle: 12, construction: 24, logistics: 48 });
    });

    it("rejects a cadence interval below 1 (would divide by zero)", () => {
      const result = ExperimentConfigSchema.safeParse({
        cadence: { cycle: 0, construction: 24, logistics: 24 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-integer cadence interval", () => {
      const result = ExperimentConfigSchema.safeParse({
        cadence: { cycle: 12.5, construction: 24, logistics: 24 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("experimentToHarnessConfig", () => {
    it("maps config fields directly onto HarnessConfig", () => {
      const exp = ExperimentConfigSchema.parse({
        label: "test",
        seed: 99,
        ticks: 200,
        systemCount: 120,
      });

      const { config, label } = experimentToHarnessConfig(exp);

      expect(label).toBe("test");
      expect(config).toEqual({ systemCount: 120, seed: 99, tickCount: 200 });
    });

    it("forwards a cadence override onto the harness config", () => {
      const exp = ExperimentConfigSchema.parse({
        seed: 7,
        cadence: { cycle: 12, construction: 24, logistics: 48 },
      });

      const { config } = experimentToHarnessConfig(exp);

      expect(config.cadence).toEqual({ cycle: 12, construction: 24, logistics: 48 });
    });

    it("omits label when none is specified", () => {
      const exp = ExperimentConfigSchema.parse({});
      const { label } = experimentToHarnessConfig(exp);
      expect(label).toBeUndefined();
    });
  });

  describe("buildExperimentResult", () => {
    // A minimal-but-fully-typed HarnessResults fixture — buildExperimentResult only projects a
    // subset of fields, but the function takes the whole shape, so every field needs a value.
    function minimalResults(): HarnessResults {
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
        worldCohorts: [],
        eventImpacts: [],
        logisticsActivity: {
          transferCount: 0, activeTicks: 0, totalQuantity: 0, meanTransferSize: 0,
          participatingSystems: 0, byGood: [],
        },
        buildBurstSummary: { byGood: [], globalMax: 0, worstGood: null, worstTick: null },
        regionOverview: [],
        elapsedMs: 1,
        finalWorld: generateWorld({ systemCount: 60, seed: 1 }),
        initialPopulationTotal: 0,
        initialBuildingTotal: 0,
        populationSnapshots: [],
        migrationThroughput: { totalColonists: 0, totalDiffusion: 0, cycleCount: 0, meanPerCycle: 0 },
        foundingStock: {
          foundedCount: 0, sampledCount: 0, meanOpeningSatisfaction: 0,
          meanOpeningDissatisfaction: 0, openingDeprivedCount: 0,
        },
        treasurySummary: {
          factionCount: 0, meanBalance: 0, minBalance: 0, maxBalance: 0,
          headsShare: 0, productionShare: 0,
          fundedMeans: { maintenance: 0, logistics: 0, construction: 0 },
          invalidRows: 0, firstShortfallTick: null,
        },
        treasurySnapshots: [],
      };
    }

    it("includes the build-burst summary in the saved experiment JSON", () => {
      const results = minimalResults();
      results.buildBurstSummary = {
        byGood: [{ goodId: "food", maxLevelsPerCycle: 7, tick: 48 }],
        globalMax: 7,
        worstGood: "food",
        worstTick: 48,
      };
      const saved = buildExperimentResult(results);
      expect(saved.buildBurstSummary).toEqual(results.buildBurstSummary);
    });

    it("reports the zero/null build-burst shape for a run with no construction activity", () => {
      const saved = buildExperimentResult(minimalResults());
      expect(saved.buildBurstSummary).toEqual({ byGood: [], globalMax: 0, worstGood: null, worstTick: null });
    });

    it("includes the migration-throughput summary in the saved experiment JSON", () => {
      const results = minimalResults();
      results.migrationThroughput = { totalColonists: 120, totalDiffusion: 30, cycleCount: 3, meanPerCycle: 50 };
      const saved = buildExperimentResult(results);
      expect(saved.migrationThroughput).toEqual(results.migrationThroughput);
    });

    it("reports the zero shape for a run with no migration activity", () => {
      const saved = buildExperimentResult(minimalResults());
      expect(saved.migrationThroughput).toEqual({ totalColonists: 0, totalDiffusion: 0, cycleCount: 0, meanPerCycle: 0 });
    });

    // The cohorted reads are the whole point of a saved artifact being comparable: a galaxy-wide
    // median moves with cohort MIX, so two runs can only be read against each other per role and
    // per world cohort. Dropping either field silently makes saved experiments incomparable.
    it("includes the per-role cover breakdown in the saved experiment JSON", () => {
      const results = minimalResults();
      results.roleCoverLevels = [{
        goodId: "fuel",
        countByRole: { exporter: 220, "self-supplier": 14, consumer: 88, inert: 15 },
        medianCoverByRole: { exporter: 0.25, "self-supplier": 0.9, consumer: 0.87 },
        trulyInertCount: 0,
        consumerEmptyFrac: 0.1,
        exporterMedianPriceRatio: 2.5,
      }];
      const saved = buildExperimentResult(results);
      expect(saved.roleCoverLevels).toEqual(results.roleCoverLevels);
    });

    it("includes the per-world-cohort supply breakdown in the saved experiment JSON", () => {
      const results = minimalResults();
      results.worldCohorts = [{
        cohort: "pop >=1K",
        n: 370,
        meanDissatisfaction: 0.011,
        meanUnrest: 0.14,
        strikingShare: 0,
        suppliedShare: 0.34,
        rationingShare: 0.627,
        shortageShare: 0.033,
      }];
      const saved = buildExperimentResult(results);
      expect(saved.worldCohorts).toEqual(results.worldCohorts);
    });

    it("reports empty cohort reads for a run that produced none", () => {
      const saved = buildExperimentResult(minimalResults());
      expect(saved.roleCoverLevels).toEqual([]);
      expect(saved.worldCohorts).toEqual([]);
    });
  });
});
