import { describe, it, expect } from "vitest";
import {
  applyDevelopments,
  addMarketsForSettledSystems,
  applyBuildingIncreases,
  applyStagedManifestDelivery,
  applyFoundingStagingDraws,
} from "@/lib/world/tick";
import { emptyResourceVector, unitResourceVector } from "@/lib/engine/resources";
import type { TickSystem } from "@/lib/tick/rows";
import type { WorldMarket } from "@/lib/world/types";
import type { SystemDevelopment, BuildBuildingUpdate } from "@/lib/tick/world/directed-build-world";
import { HOUSING_TYPE, POP_CENTRE_DENSITY } from "@/lib/constants/industry";
import { housingPopCap } from "@/lib/engine/industry";

/** Minimal valid TickSystem fixture — only the fields `applyDevelopments` reads/writes matter for
 * this suite; the rest are innocuous placeholders that still type-check. */
function makeSystem(id: string, population: number): TickSystem {
  return {
    id,
    name: id,
    economyType: "agricultural",
    regionId: "region-1",
    factionId: "faction-1",
    control: "controlled",
    governmentType: "federation",
    population,
    popCap: 1000,
    unrest: 0,
    buildings: {},
    buildingIdleCycles: {},
    collapseDebt: 0,
    yields: unitResourceVector(),
    slotCap: emptyResourceVector(),
    generalSpace: 100,
    habitableSpace: 100,
  };
}

function totalPopulation(systems: TickSystem[]): number {
  return systems.reduce((n, s) => n + s.population, 0);
}

describe("applyDevelopments", () => {
  it("conserves population when two developments share an insufficient source", () => {
    const source = makeSystem("source", 60);
    const targetA = makeSystem("target-a", 0);
    const targetB = makeSystem("target-b", 0);
    const systems = [source, targetA, targetB];
    const developments: SystemDevelopment[] = [
      { systemId: "target-a", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] },
      { systemId: "target-b", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] },
    ];

    const before = totalPopulation(systems);
    const after = applyDevelopments(systems, developments);

    expect(totalPopulation(after)).toBe(before); // conserved, not minted

    const afterSource = after.find((s) => s.id === "source")!;
    const afterA = after.find((s) => s.id === "target-a")!;
    const afterB = after.find((s) => s.id === "target-b")!;

    expect(afterSource.population).toBeGreaterThanOrEqual(0);
    expect(afterSource.population).toBe(0); // fully drained: 50 to A, remaining 10 to B
    expect(afterA.population).toBe(50);
    expect(afterB.population).toBe(10);
    // Exactly what the source lost was credited to the two targets.
    expect(afterA.population + afterB.population).toBe(before - afterSource.population);

    for (const s of after) {
      expect(Number.isFinite(s.population)).toBe(true);
      expect(s.population).toBeGreaterThanOrEqual(0);
    }
  });

  it("moves the full seed on a single develop with a sufficient source (regression)", () => {
    const source = makeSystem("source", 200);
    const target = makeSystem("target", 0);
    target.control = "controlled";
    target.popCap = 0; // inert controlled system
    const systems = [source, target];
    const developments: SystemDevelopment[] = [
      { systemId: "target", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] },
    ];

    const before = totalPopulation(systems);
    const after = applyDevelopments(systems, developments);

    expect(totalPopulation(after)).toBe(before);

    const afterSource = after.find((s) => s.id === "source")!;
    const afterTarget = after.find((s) => s.id === "target")!;
    expect(afterSource.population).toBe(150);
    expect(afterSource.control).toBe("controlled");
    expect(afterTarget.population).toBe(50);
    expect(afterTarget.control).toBe("developed");
    expect(afterTarget.buildings[HOUSING_TYPE]).toBe(3);                       // bundled housing placed
    expect(afterTarget.popCap).toBeGreaterThanOrEqual(afterTarget.population); // viable by construction
    expect(afterTarget.popCap).toBe(housingPopCap({ [HOUSING_TYPE]: 3 }));     // popCap = placed housing

    for (const s of after) {
      expect(Number.isFinite(s.population)).toBe(true);
      expect(s.population).toBeGreaterThanOrEqual(0);
    }
  });

  it("lands a viable colony: housing placed, popCap ≥ seed, source keeps the rest (land-poor seed)", () => {
    const source = makeSystem("source", 500);
    const colony = makeSystem("colony", 0);
    colony.control = "controlled";
    colony.popCap = 0;
    colony.buildings = {};
    const systems = [source, colony];
    // A land-poor seed of 25 (below one full housing level's density) with a single bundled housing level.
    const developments: SystemDevelopment[] = [
      { systemId: "colony", sourceSystemId: "source", seedPop: 25, housingLevels: 2, stockManifest: [] },
    ];
    const after = applyDevelopments(systems, developments);
    const c = after.find((s) => s.id === "colony")!;
    const src = after.find((s) => s.id === "source")!;
    expect(c.control).toBe("developed");
    expect(c.population).toBe(25);
    expect(c.buildings[HOUSING_TYPE]).toBe(2);
    expect(c.popCap).toBe(2 * POP_CENTRE_DENSITY);
    expect(c.popCap).toBeGreaterThanOrEqual(c.population); // no popCap≈0 stranded state
    expect(src.population).toBe(475);                       // conserved: 500 − 25
    for (const s of after) expect(Number.isFinite(s.popCap)).toBe(true);
  });
});

describe("applyDevelopments — no-ops and unresolvable rows", () => {
  it("returns the very same array when there is nothing to develop", () => {
    const systems = [makeSystem("a", 10), makeSystem("b", 20)];
    expect(applyDevelopments(systems, [])).toBe(systems);
  });

  it("hands back every bystander system by reference, not a rebuilt copy", () => {
    // Only the pair a development names may be rewritten; a cycle that develops one colony must not
    // churn every other system row in the galaxy.
    const source = makeSystem("source", 200);
    const target = makeSystem("target", 0);
    const bystander = makeSystem("bystander", 77);
    const after = applyDevelopments(
      [source, target, bystander],
      [{ systemId: "target", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] }],
    );
    expect(after.find((s) => s.id === "bystander")).toBe(bystander);
  });

  it("skips a development whose source system is not in the list", () => {
    const target = makeSystem("target", 0);
    const after = applyDevelopments(
      [target],
      [{ systemId: "target", sourceSystemId: "missing", seedPop: 50, housingLevels: 3, stockManifest: [] }],
    );
    expect(after).toEqual([target]);
    expect(after.find((s) => s.id === "target")!.control).toBe("controlled"); // not developed
  });

  it("skips a development whose target system is not in the list, leaving the source whole", () => {
    // The source must not be debited for a colony that does not exist to receive the people.
    const source = makeSystem("source", 200);
    const after = applyDevelopments(
      [source],
      [{ systemId: "missing", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] }],
    );
    expect(after.find((s) => s.id === "source")!.population).toBe(200);
  });

  it("clears a stale stored provisionExpectation when a system flips to developed", () => {
    // The resettlement rule: a system carrying a drifted memory from a previous life must not
    // carry it into the new one — it seeds fresh, exactly as a first-time colony does.
    const source = makeSystem("source", 200);
    const target = makeSystem("target", 0);
    target.provisionExpectation = 0.87; // stale memory from a previous life
    const systems = [source, target];
    const developments: SystemDevelopment[] = [
      { systemId: "target", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] },
    ];

    const after = applyDevelopments(systems, developments);
    const developed = after.find((s) => s.id === "target")!;
    expect(developed.control).toBe("developed");
    expect(developed.provisionExpectation).toBeUndefined();
    expect("provisionExpectation" in developed).toBe(false);
  });

  it("leaves an untouched system's provisionExpectation alone", () => {
    // The clear is surgical — a system a development did not name keeps whatever it carried.
    const source = makeSystem("source", 200);
    source.provisionExpectation = 0.55;
    const target = makeSystem("target", 0);
    const systems = [source, target];
    const developments: SystemDevelopment[] = [
      { systemId: "target", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] },
    ];

    const after = applyDevelopments(systems, developments);
    const afterSource = after.find((s) => s.id === "source")!;
    expect(afterSource.control).toBe("controlled"); // never flipped to developed
    expect(afterSource.provisionExpectation).toBe(0.55);
  });

  it("develops a target whose seed transfer moves nobody", () => {
    // A drained source moves zero people, so the population delta is 0 — but the colony still has to
    // flip to `developed`, or a completed establish silently produces nothing.
    const source = makeSystem("source", 0);
    const target = makeSystem("target", 0);
    const after = applyDevelopments(
      [source, target],
      [{ systemId: "target", sourceSystemId: "source", seedPop: 50, housingLevels: 3, stockManifest: [] }],
    );
    const developed = after.find((s) => s.id === "target")!;
    expect(developed.control).toBe("developed");
    expect(developed.population).toBe(0);
    expect(developed.buildings[HOUSING_TYPE]).toBe(3);
  });
});

describe("addMarketsForSettledSystems", () => {
  it("opens a new colony's rows EMPTY — the founder's manifest is the first stock it holds", () => {
    const colony = makeSystem("colony", 40);
    const after = addMarketsForSettledSystems(
      [],
      [colony],
      [{ systemId: "colony", sourceSystemId: "source", seedPop: 40, housingLevels: 3, stockManifest: [] }],
    );
    expect(after.length).toBeGreaterThan(0);
    for (const row of after) {
      expect(row.systemId).toBe("colony");
      expect(row.stock).toBe(0);
    }
  });

  it("keeps a resettled system's existing warehouses and adds no duplicate row", () => {
    const colony = makeSystem("colony", 40);
    const development: SystemDevelopment = {
      systemId: "colony", sourceSystemId: "source", seedPop: 40, housingLevels: 3, stockManifest: [],
    };
    const first = addMarketsForSettledSystems([], [colony], [development]);
    const stocked = first.map((row, i) => (i === 0 ? { ...row, stock: 500 } : row));

    const second = addMarketsForSettledSystems(stocked, [colony], [development]);
    expect(second).toBe(stocked); // nothing new to add → the same array, not a rebuilt copy
    expect(second.length).toBe(first.length);
    expect(second[0].stock).toBe(500);
  });

  it("skips a development naming a system that is not in the row list", () => {
    const markets = [market("elsewhere", "food", 5)];
    const after = addMarketsForSettledSystems(
      markets,
      [makeSystem("colony", 40)],
      [{ systemId: "missing", sourceSystemId: "source", seedPop: 40, housingLevels: 3, stockManifest: [] }],
    );
    expect(after).toBe(markets);
  });
});

describe("applyBuildingIncreases — popCap tracks built housing", () => {
  function developedColony(id: string, housingLevels: number, population: number): TickSystem {
    const s = makeSystem(id, population);
    s.control = "developed";
    s.buildings = { [HOUSING_TYPE]: housingLevels };
    s.popCap = housingPopCap(s.buildings);
    return s;
  }

  it("raises popCap when construction completes a housing level", () => {
    // The regression this guards: applyBuildingIncreases updated the housing COUNT but left popCap
    // stale, so a colony could build housing yet never grow into it (popCap welded to its seed).
    const colony = developedColony("colony", 1, 20); // popCap 20
    const updates: BuildBuildingUpdate[] = [{ systemId: "colony", buildingType: HOUSING_TYPE, count: 3 }];
    const after = applyBuildingIncreases([colony], updates);
    const c = after.find((s) => s.id === "colony")!;
    expect(c.buildings[HOUSING_TYPE]).toBe(3);
    expect(c.popCap).toBe(housingPopCap({ [HOUSING_TYPE]: 3 })); // 3 × POP_CENTRE_DENSITY, not the stale 20
  });

  it("leaves popCap untouched for a non-housing build", () => {
    const colony = developedColony("colony", 5, 50); // popCap 100
    const before = colony.popCap;
    const updates: BuildBuildingUpdate[] = [{ systemId: "colony", buildingType: "metals", count: 4 }];
    const after = applyBuildingIncreases([colony], updates);
    const c = after.find((s) => s.id === "colony")!;
    expect(c.buildings["metals"]).toBe(4);
    expect(c.popCap).toBe(before); // extraction doesn't house anyone
  });

  it("never lowers popCap (decay owns downward moves)", () => {
    const colony = developedColony("colony", 2, 30);
    colony.popCap = 100; // seeded higher than current housing implies
    const updates: BuildBuildingUpdate[] = [{ systemId: "colony", buildingType: HOUSING_TYPE, count: 2 }];
    const after = applyBuildingIncreases([colony], updates);
    const c = after.find((s) => s.id === "colony")!;
    expect(c.popCap).toBe(100); // max(100, housingPopCap(2)=40)
  });
});

/** Minimal market row — only systemId/goodId/stock matter to the two founding passes. */
function market(systemId: string, goodId: string, stock: number): WorldMarket {
  return { systemId, goodId, stock, anchorMult: 1, demandRate: 1, storageCapacity: 0 };
}

const stockAt = (markets: WorldMarket[], systemId: string, goodId: string) =>
  markets.find((m) => m.systemId === systemId && m.goodId === goodId)!.stock;

const totalStock = (markets: WorldMarket[], goodId: string) =>
  markets.filter((m) => m.goodId === goodId).reduce((n, m) => n + m.stock, 0);

describe("applyStagedManifestDelivery", () => {
  it("opens the colony holding exactly its staged ledger, with the founder untouched", () => {
    // The falsifier for the whole change: the goods left the founder cycle by cycle as they were
    // staged, so delivery is a credit. Swap in the old conserving move and the source is debited a
    // second time here for materials it already paid for.
    const markets = [
      market("source", "food", 100), market("colony", "food", 0),
      market("source", "water", 80), market("colony", "water", 0),
    ];
    const developments: SystemDevelopment[] = [{
      systemId: "colony", sourceSystemId: "source", seedPop: 2, housingLevels: 1,
      stockManifest: [{ goodId: "food", quantity: 12 }, { goodId: "water", quantity: 7 }],
    }];

    const after = applyStagedManifestDelivery(markets, developments);
    expect(stockAt(after, "colony", "food")).toBe(12);
    expect(stockAt(after, "colony", "water")).toBe(7);
    expect(stockAt(after, "source", "food")).toBe(100); // the founder is not touched at all
    expect(stockAt(after, "source", "water")).toBe(80);
    // The staged goods re-enter the world's market rows here and nowhere else.
    expect(totalStock(after, "food")).toBe(totalStock(markets, "food") + 12);
    expect(totalStock(after, "water")).toBe(totalStock(markets, "water") + 7);
  });

  it("delivers each of two colonies its own ledger in full", () => {
    // Two colonies off one founder: neither ledger is capped by the other, nor by what the source
    // still holds — both were debited long ago.
    const markets = [
      market("source", "food", 10), market("a", "food", 0), market("b", "food", 0),
    ];
    const developments: SystemDevelopment[] = [
      { systemId: "a", sourceSystemId: "source", seedPop: 2, housingLevels: 1, stockManifest: [{ goodId: "food", quantity: 30 }] },
      { systemId: "b", sourceSystemId: "source", seedPop: 2, housingLevels: 1, stockManifest: [{ goodId: "food", quantity: 25 }] },
    ];

    const after = applyStagedManifestDelivery(markets, developments);
    expect(stockAt(after, "a", "food")).toBe(30);
    expect(stockAt(after, "b", "food")).toBe(25);
    expect(stockAt(after, "source", "food")).toBe(10);
  });

  it("lands the colony unchanged when the ledger is empty, and serialises cleanly", () => {
    const markets = [market("source", "food", 100), market("colony", "food", 0)];
    const developments: SystemDevelopment[] = [{
      systemId: "colony", sourceSystemId: "source", seedPop: 2, housingLevels: 1, stockManifest: [],
    }];

    const after = applyStagedManifestDelivery(markets, developments);
    expect(after).toBe(markets); // no delta at all — the same array, not a rebuilt copy
    expect(JSON.parse(JSON.stringify(developments[0])).stockManifest).toEqual([]);
  });

  it("skips a non-finite or non-positive line rather than writing it into world state", () => {
    // Stock is world state and JSON.stringify turns NaN/Infinity into null, silently corrupting a save.
    const markets = [market("source", "food", 100), market("colony", "food", 0)];
    const developments: SystemDevelopment[] = [{
      systemId: "colony", sourceSystemId: "source", seedPop: 2, housingLevels: 1,
      stockManifest: [
        { goodId: "food", quantity: Number.NaN },
        { goodId: "food", quantity: Number.POSITIVE_INFINITY },
        { goodId: "food", quantity: -5 },
        { goodId: "food", quantity: 0 }, // a line that moves nothing is not a delta either
      ],
    }];

    const after = applyStagedManifestDelivery(markets, developments);
    expect(after).toBe(markets);
    for (const m of after) expect(Number.isFinite(m.stock)).toBe(true);
  });

  it("credits nothing for a good the colony has no market row for", () => {
    // Delivery runs after `addMarketsForSettledSystems`, so a colony has a row for every good it can
    // hold. A line with no row is dropped rather than minted onto a fresh one.
    const markets = [market("source", "food", 100), market("colony", "food", 0)];
    const developments: SystemDevelopment[] = [{
      systemId: "colony", sourceSystemId: "source", seedPop: 2, housingLevels: 1,
      stockManifest: [{ goodId: "food", quantity: 5 }, { goodId: "exotics", quantity: 9 }],
    }];

    const after = applyStagedManifestDelivery(markets, developments);
    expect(stockAt(after, "colony", "food")).toBe(5);
    expect(after.some((m) => m.goodId === "exotics")).toBe(false);
  });
});

describe("applyFoundingStagingDraws", () => {
  it("debits each source and credits nothing — staged goods are in transit", () => {
    const markets = [
      market("source", "food", 100), market("colony", "food", 0), market("other", "food", 40),
    ];
    const after = applyFoundingStagingDraws(markets, [
      { sourceSystemId: "source", goodId: "food", quantity: 12 },
      { sourceSystemId: "other", goodId: "food", quantity: 5 },
    ]);
    expect(stockAt(after, "source", "food")).toBe(88);
    expect(stockAt(after, "other", "food")).toBe(35);
    // The colony gets nothing until it opens: the draw leaves the world's markets entirely.
    expect(stockAt(after, "colony", "food")).toBe(0);
    expect(totalStock(after, "food")).toBe(totalStock(markets, "food") - 17);
  });

  it("draws down one source across the whole pass, so the pair fits what the row held", () => {
    // Two draws on one source in one cycle: the second sees what the first left.
    const markets = [market("source", "food", 10)];
    const after = applyFoundingStagingDraws(markets, [
      { sourceSystemId: "source", goodId: "food", quantity: 6 },
      { sourceSystemId: "source", goodId: "food", quantity: 4 },
    ]);
    expect(stockAt(after, "source", "food")).toBe(0); // emptied, never negative
  });

  it("throws rather than shorten a draw its source cannot cover", () => {
    // Shortening is what would make this silent: the ledger keeps the full quantity, the colony is
    // credited it at delivery, and goods that never left the founder are minted with every test
    // green. A throw fails the tick instead, and the store commits only a fully-successful tick.
    const markets = [market("source", "food", 10)];
    expect(() =>
      applyFoundingStagingDraws(markets, [
        { sourceSystemId: "source", goodId: "food", quantity: 8 },
        { sourceSystemId: "source", goodId: "food", quantity: 8 }, // only 2 left by now
      ]),
    ).toThrow(/source\|food: drawing 8, holding 2/);
    // A draw whose source row has gone is the same fault at its extreme — all of it was never paid.
    expect(() =>
      applyFoundingStagingDraws(markets, [{ sourceSystemId: "gone", goodId: "food", quantity: 5 }]),
    ).toThrow(/gone\|food: drawing 5, holding 0/);
    expect(stockAt(markets, "source", "food")).toBe(10); // and nothing was mutated on the way out
  });

  it("skips non-finite and non-positive draws rather than writing them", () => {
    const markets = [market("source", "food", 100)];
    const after = applyFoundingStagingDraws(markets, [
      { sourceSystemId: "source", goodId: "food", quantity: Number.NaN },
      { sourceSystemId: "source", goodId: "food", quantity: Number.POSITIVE_INFINITY },
      { sourceSystemId: "source", goodId: "food", quantity: -5 },
      { sourceSystemId: "source", goodId: "food", quantity: 0 }, // moves nothing — not a delta either
    ]);
    expect(after).toBe(markets); // no delta at all — the same array, not a rebuilt copy
    for (const m of after) expect(Number.isFinite(m.stock)).toBe(true);
  });
});
