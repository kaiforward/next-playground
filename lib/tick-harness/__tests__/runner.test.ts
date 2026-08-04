import { describe, it, expect } from "vitest";
import { founderCoverAfter, runTickHarness } from "../runner";
import { MARKET_ROLES } from "../types";
import type { HarnessConfig, MarketRole } from "../types";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { unitResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import type { TickSystem } from "@/lib/tick/rows";
import type { MarketRowForLogistics } from "@/lib/tick/world/directed-logistics-world";

/** Small and short: this suite is about the role pin's wiring, not about economy behaviour. */
const CONFIG: HarnessConfig = { systemCount: 20, seed: 7, tickCount: 60 };

describe("runTickHarness: the role partition", () => {
  it("reports a role for every market it classified", async () => {
    const results = await runTickHarness(CONFIG);
    const entries = Object.entries(results.marketRoles);

    expect(entries.length).toBeGreaterThan(0);
    for (const [key, role] of entries) {
      expect(key).toContain("|"); // systemId|goodId
      expect(MARKET_ROLES).toContain(role);
    }
  });

  it("is unchanged when pinned to the partition the run itself produced", async () => {
    // Pinning an arm to its own fresh partition has to reproduce the unpinned report exactly,
    // or the pin is itself a change and no A/B run through it means anything.
    const unpinned = await runTickHarness(CONFIG);
    const pinned = await runTickHarness({ ...CONFIG, pinnedRoles: unpinned.marketRoles });

    expect(pinned.roleCoverLevels).toEqual(unpinned.roleCoverLevels);
  });

  it("reports the live partition even when pinned, so a pin cannot be chained into itself", async () => {
    // `marketRoles` is what THIS arm classified, never an echo of the pin — otherwise a second
    // arm pinned to the first would report the first's partition and the drift would be invisible.
    const unpinned = await runTickHarness(CONFIG);
    const allConsumer: Record<string, MarketRole> = {};
    for (const key of Object.keys(unpinned.marketRoles)) allConsumer[key] = "consumer";

    const pinned = await runTickHarness({ ...CONFIG, pinnedRoles: allConsumer });
    expect(pinned.marketRoles).toEqual(unpinned.marketRoles);
  });

  it("actually applies the pin it is given", async () => {
    // Guards the identity test above from passing vacuously: if `pinnedRoles` were dropped on the
    // floor, the identity would hold trivially and prove nothing.
    const unpinned = await runTickHarness(CONFIG);
    const allConsumer: Record<string, MarketRole> = {};
    for (const key of Object.keys(unpinned.marketRoles)) allConsumer[key] = "consumer";

    const pinned = await runTickHarness({ ...CONFIG, pinnedRoles: allConsumer });
    for (const entry of pinned.roleCoverLevels) {
      expect(entry.countByRole.exporter).toBe(0);
      expect(entry.countByRole["self-supplier"]).toBe(0);
      expect(entry.countByRole.inert).toBe(0);
      expect(entry.countByRole.consumer).toBeGreaterThan(0);
    }
    // Non-vacuous: the unpinned run really does classify markets into other roles.
    expect(unpinned.roleCoverLevels.some((e) => e.countByRole.consumer === 0)).toBe(true);
  });
});

// ── founderCoverAfter ─────────────────────────────────────────────
// The binding-good minimum behind `medianFounderCoverAfter`. The exits matter as much as the
// arithmetic: "could not measure" must come back undefined, never a 0 that reads as a founder
// drained flat.

describe("founderCoverAfter", () => {
  const founder: TickSystem = {
    id: "home", name: "home", economyType: "extraction", regionId: "r1", factionId: "f1",
    control: "developed", governmentType: "federation", population: 100, popCap: 1000, unrest: 0,
    buildings: {}, buildingIdleCycles: {}, collapseDebt: 0, yields: unitResourceVector(),
    slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
  };
  // The persisted use figure drives the donor floor: reserve = DONOR_RESERVE_COVER × use.
  const row = (goodId: string, stock: number, useRate: number): MarketRowForLogistics => ({
    id: `home|${goodId}`, goodId, stock, anchorMult: 1, demandRate: 1,
    honestUseRate: useRate, storageCapacity: 0,
  });
  const reserve = (useRate: number) => DIRECTED_LOGISTICS.DONOR_RESERVE_COVER * useRate;

  it("takes the minimum across the manifest's goods only", () => {
    // ore sits at stock 0 but was NOT shipped — it must not drag the reading to 0.
    const rows = [row("food", 100, 10), row("water", 10, 10), row("ore", 0, 10)];
    const cover = founderCoverAfter(founder, rows, ["food", "water"]);
    expect(cover).toBeCloseTo(10 / reserve(10), 9); // water binds
  });

  it("skips a shipped good with no donor floor rather than counting it as cover 0", () => {
    // A good the founder itself has no use for has reserve 0 — there was no floor to be drawn
    // under, which is the opposite reading of "drained to 0".
    const rows = [row("food", 100, 10), row("luxuries", 0, 0)];
    const cover = founderCoverAfter(founder, rows, ["food", "luxuries"]);
    expect(cover).toBeCloseTo(100 / reserve(10), 9); // food alone measures
  });

  it("returns undefined when no shipped good is measurable", () => {
    expect(founderCoverAfter(founder, [row("luxuries", 50, 0)], ["luxuries"])).toBeUndefined();
  });

  it("returns undefined for an unknown founder, missing rows, or an empty manifest", () => {
    const rows = [row("food", 100, 10)];
    expect(founderCoverAfter(undefined, rows, ["food"])).toBeUndefined();
    expect(founderCoverAfter(founder, undefined, ["food"])).toBeUndefined();
    expect(founderCoverAfter(founder, rows, [])).toBeUndefined();
  });
});
