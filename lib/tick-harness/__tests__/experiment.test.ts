import { describe, it, expect } from "vitest";
import {
  ExperimentConfigSchema,
  experimentToHarnessConfig,
  buildExperimentResult,
  parsePinnedRoles,
  pinnedRolesFor,
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
        marketRoles: {},
        demandHunting: { flipRate: 0, haulChurnRatio: 0 },
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
          meanManifestTonnage: 0, medianFounderCoverAfter: null,
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

    it("includes the role partition in the saved experiment JSON — the field --pin reads back", () => {
      const results = minimalResults();
      results.marketRoles = { "s1|ore": "exporter", "s2|ore": "consumer" };
      const saved = buildExperimentResult(results);
      expect(saved.marketRoles).toEqual(results.marketRoles);
    });

    it("includes both stage-gate readings — hunting and founding cost — in the saved JSON", () => {
      const results = minimalResults();
      results.demandHunting = { flipRate: 0.12, haulChurnRatio: 0.03 };
      results.foundingStock = {
        foundedCount: 4, sampledCount: 3, meanOpeningSatisfaction: 0.9,
        meanOpeningDissatisfaction: 0.02, openingDeprivedCount: 0,
        meanManifestTonnage: 250, medianFounderCoverAfter: 1.4,
      };
      const saved = buildExperimentResult(results);
      expect(saved.demandHunting).toEqual(results.demandHunting);
      expect(saved.foundingStock).toEqual(results.foundingStock);
    });
  });
});

describe("parsePinnedRoles", () => {
  const roles = { "s1|ore": "exporter", "s2|ore": "consumer" };

  it("reads the partition off a single saved result", () => {
    const parsed = parsePinnedRoles(JSON.stringify({ marketRoles: roles, elapsedMs: 1 }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.document.single).toEqual(roles);
    expect(pinnedRolesFor(parsed.document, "equilibrium")).toEqual(roles);
  });

  it("reads a partition per horizon off a quick-run report, and keeps them apart", () => {
    // The quick run emits both horizons in one document. Pinning an equilibrium arm to a startup
    // partition would compare two arms against a membership neither of them has.
    const startup = { "s1|ore": "consumer" };
    const parsed = parsePinnedRoles(JSON.stringify({
      startup: { marketRoles: startup },
      equilibrium: { marketRoles: roles },
    }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(pinnedRolesFor(parsed.document, "startup")).toEqual(startup);
    expect(pinnedRolesFor(parsed.document, "equilibrium")).toEqual(roles);
  });

  it("rejects a document carrying no partition at all, naming what it looked for", () => {
    const parsed = parsePinnedRoles(JSON.stringify({ marketHealth: {}, elapsedMs: 1 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("marketRoles");
  });

  it("rejects a value that is not one of the four roles", () => {
    // A typo'd or stale role would silently create a fifth cohort that counts nothing.
    const parsed = parsePinnedRoles(JSON.stringify({ marketRoles: { "s1|ore": "importer" } }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("importer");
  });

  it("rejects a file that is not JSON at all", () => {
    const parsed = parsePinnedRoles("not json {");
    expect(parsed.ok).toBe(false);
  });

  it("reports no partition for a horizon the document does not carry", () => {
    const parsed = parsePinnedRoles(JSON.stringify({ equilibrium: { marketRoles: roles } }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(pinnedRolesFor(parsed.document, "startup")).toBeUndefined();
  });

  it("reports no partition for a horizon-keyed document asked with no horizon — config mode's shape", () => {
    // The --config path calls pinnedRolesFor with no horizon; for a quick-run document that means
    // undefined, and simulate.ts turns undefined into a loud exit rather than a silently unpinned
    // run. This pins the contract's undefined half.
    const parsed = parsePinnedRoles(JSON.stringify({
      startup: { marketRoles: { "s1|ore": "consumer" } },
      equilibrium: { marketRoles: roles },
    }));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(pinnedRolesFor(parsed.document)).toBeUndefined();
  });

  it("rejects a marketRoles that is not an object", () => {
    const parsed = parsePinnedRoles(JSON.stringify({ marketRoles: 5 }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("not an object");
  });

  it("rejects a malformed role inside a nested horizon", () => {
    const parsed = parsePinnedRoles(JSON.stringify({
      startup: { marketRoles: { "s1|ore": "importer" } },
    }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain("importer");
  });
});
