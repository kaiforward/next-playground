import { describe, it, expect } from "vitest";
import {
  bodyDepositFeatures, habitabilityScoreBand, occupiedBodyIds, potentialYieldRows,
  type OccupancyBody,
} from "../substrate";
import { makeResourceVector, emptyResourceVector } from "@/lib/engine/resources";
import { HABITABILITY_THRESHOLD } from "@/lib/constants/bodies";
import type { PotentialYieldRow } from "@/lib/engine/worked-deposits";

describe("bodyDepositFeatures", () => {
  it("lists present deposits as named features, richest grade first, carrying worked/total", () => {
    const slots = makeResourceVector({ ore: 8, gas: 2 });
    const quality = makeResourceVector({ ore: 1.6, gas: 0.5 }); // ore "good", gas "poor"
    const worked = makeResourceVector({ ore: 5, gas: 0 });
    const features = bodyDepositFeatures(slots, quality, worked);
    expect(features.map((f) => f.resource)).toEqual(["ore", "gas"]); // higher quality first
    expect(features[0].band).toBe("good"); // 1.6 ≤ 1.8
    expect(features[0].name).toMatch(/ore/i);
    expect(features[0].worked).toBe(5);
    expect(features[0].total).toBe(8);
    expect(features[1].band).toBe("poor"); // 0.5 ≤ 0.7
    expect(features[1].worked).toBe(0);
    expect(features[1].total).toBe(2);
  });
  it("excludes resources with no deposit", () => {
    expect(bodyDepositFeatures(emptyResourceVector(), emptyResourceVector(), emptyResourceVector())).toEqual([]);
  });
});

describe("habitabilityScoreBand", () => {
  it("bands the top score as rich", () => {
    expect(habitabilityScoreBand(1.0)).toBe("rich");
  });
  it("bands the rich/good boundary at 0.9 — 0.9 rich, 0.89 good", () => {
    expect(habitabilityScoreBand(0.9)).toBe("rich");
    expect(habitabilityScoreBand(0.89)).toBe("good");
  });
  it("bands a score at the habitability threshold as good — never bare average", () => {
    expect(habitabilityScoreBand(HABITABILITY_THRESHOLD)).toBe("good");
    expect(habitabilityScoreBand(0.6)).toBe("good");
  });
  it("bands a sub-threshold-but-authored score as average, not poor", () => {
    expect(habitabilityScoreBand(0.35)).toBe("average");
  });
  it("bands the average/poor boundary at 0.2 — 0.2 average, 0.19 poor", () => {
    expect(habitabilityScoreBand(0.2)).toBe("average");
    expect(habitabilityScoreBand(0.19)).toBe("poor");
  });
  it("bands an effectively-dead score as poor, including zero", () => {
    expect(habitabilityScoreBand(0.05)).toBe("poor");
    expect(habitabilityScoreBand(0)).toBe("poor");
  });
});

describe("occupiedBodyIds", () => {
  const best: OccupancyBody = { id: "best", score: 1.0, locked: false };
  const worse: OccupancyBody = { id: "worse", score: 0.6, locked: false };
  const deadWorld: OccupancyBody = { id: "dead", score: 0, locked: false };
  const lockedHabitable: OccupancyBody = { id: "locked", score: 0.05, locked: true };

  it("marks only the prefix up to frontierIndex occupied, score-descending — never every people-land body", () => {
    const occupied = occupiedBodyIds(
      [worse, best, deadWorld, lockedHabitable],
      { quality: 1, frontierIndex: 0 },
    );
    expect(occupied.has("best")).toBe(true);
    expect(occupied.has("worse")).toBe(false);
    expect(occupied.has("dead")).toBe(false);
    expect(occupied.has("locked")).toBe(false);
  });

  it("extends the occupied prefix as frontierIndex advances past the best body", () => {
    const occupied = occupiedBodyIds([worse, best], { quality: 0.8, frontierIndex: 1 });
    expect(occupied.has("best")).toBe(true);
    expect(occupied.has("worse")).toBe(true);
  });

  it("marks nothing occupied when the system has never been assessed", () => {
    const occupied = occupiedBodyIds([best, worse], undefined);
    expect(occupied.size).toBe(0);
  });

  it("excludes locked and sub-threshold bodies from the contributing sort even inside the prefix window", () => {
    // frontierIndex 2 would reach past the two real contributors into the dead/locked entries if
    // the contributing filter were skipped — it must not.
    const occupied = occupiedBodyIds(
      [worse, best, deadWorld, lockedHabitable],
      { quality: 0.8, frontierIndex: 2 },
    );
    expect(occupied.has("best")).toBe(true);
    expect(occupied.has("worse")).toBe(true);
    expect(occupied.has("dead")).toBe(false);
    expect(occupied.has("locked")).toBe(false);
  });
});

describe("potentialYieldRows", () => {
  const identities = [
    { id: "b0", archetypeName: "Temperate World" },
    { id: "b1", archetypeName: "Volcanic World" },
  ];

  it("resolves bodyIndex to identity, attaches a quality band, and passes yieldMult/slotCount through unchanged", () => {
    const engineRows: PotentialYieldRow[] = [{
      resource: "ore",
      yieldMult: 1.6, // "good" band (≤1.8)
      slotCount: 3,
      byBody: [
        { bodyIndex: 0, slotCount: 1, groundValue: 0.9, locked: false },
        { bodyIndex: 1, slotCount: 2, groundValue: 0.36, locked: true },
      ],
    }];
    const rows = potentialYieldRows(engineRows, identities);

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.resource).toBe("ore");
    expect(row.yieldMult).toBe(1.6);
    expect(row.slotCount).toBe(3);
    expect(row.band).toBe("good");

    expect(row.byBody).toEqual([
      { bodyId: "b0", archetypeName: "Temperate World", slotCount: 1, groundValue: 0.9, locked: false },
      { bodyId: "b1", archetypeName: "Volcanic World", slotCount: 2, groundValue: 0.36, locked: true },
    ]);
  });

  it("an empty engine-row list resolves to an empty view list", () => {
    expect(potentialYieldRows([], identities)).toEqual([]);
  });
});
