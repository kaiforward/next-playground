import { describe, it, expect } from "vitest";
import { GOOD_COLORS, getGoodColor, EVENT_BAND } from "../ui";
import type { EventBand } from "../ui";
import { GOOD_NAMES, GOODS } from "../goods";
import { EVENT_TYPE_IDS, RELATIONS_EVENT_TYPES } from "../events";
import type { EventTypeId } from "../events";

describe("GOOD_COLORS coverage", () => {
  it("has a chart color for every good", () => {
    for (const goodId of GOOD_NAMES) {
      expect(GOOD_COLORS[goodId], `color: ${goodId}`).toBeDefined();
    }
  });

  it("defines no colors for goods that do not exist", () => {
    const known = new Set(GOOD_NAMES);
    for (const goodId of Object.keys(GOOD_COLORS)) {
      expect(known.has(goodId), `stray color key: ${goodId}`).toBe(true);
    }
  });
});

describe("getGoodColor", () => {
  it("resolves a good's color by display name", () => {
    expect(getGoodColor(GOODS.water.name)).toBe(GOOD_COLORS.water);
  });

  it("falls back to a neutral gray for an unknown good name", () => {
    expect(getGoodColor("Nonexistent Good")).toBe("#6b7280");
  });
});

describe("EVENT_BAND", () => {
  // Independently transcribed from the alert-bar band table, not read back off
  // EVENT_BAND — a test that only reflects the object at itself proves nothing.
  const EXPECTED_BAND: Record<EventTypeId, EventBand> = {
    plague: "crisis",
    pirate_raid: "crisis",
    asteroid_strike: "crisis",
    inner_system_conflict: "crisis",
    border_conflict: "crisis",
    supply_shortage: "disruption",
    solar_storm: "disruption",
    trade_embargo: "disruption",
    ore_glut: "disruption",
    alliance_dissolved: "disruption",
    conflict_spillover: "disruption",
    plague_risk: "disruption",
    refugee_crisis: "disruption",
    trade_festival: "windfall",
    mining_boom: "windfall",
    tech_breakthrough: "windfall",
    pact_under_negotiation: "windfall",
  };

  it("bands every EventTypeId exactly as the band table specifies", () => {
    for (const id of EVENT_TYPE_IDS) {
      expect(EVENT_BAND[id].band, `band: ${id}`).toBe(EXPECTED_BAND[id]);
    }
  });

  it("bands the three types the first cut omitted", () => {
    expect(EVENT_BAND.conflict_spillover.band).toBe("disruption");
    expect(EVENT_BAND.plague_risk.band).toBe("disruption");
    expect(EVENT_BAND.refugee_crisis.band).toBe("disruption");
  });

  it("bands the three relations-owned types, not just the fourteen spawned ones", () => {
    for (const id of RELATIONS_EVENT_TYPES) {
      expect(EVENT_BAND[id], `band: ${id}`).toBeDefined();
      expect(EVENT_BAND[id].band, `band: ${id}`).toBe(EXPECTED_BAND[id]);
    }
  });

  it("leaves no band empty", () => {
    const bands = new Set(EVENT_TYPE_IDS.map((id) => EVENT_BAND[id].band));
    expect(bands.has("crisis")).toBe(true);
    expect(bands.has("disruption")).toBe(true);
    expect(bands.has("windfall")).toBe(true);
  });

  it("gives crisis and disruption a total order — no two types share a rank", () => {
    for (const band of ["crisis", "disruption"] as const) {
      const ranks = EVENT_TYPE_IDS.filter((id) => EVENT_BAND[id].band === band).map(
        (id) => EVENT_BAND[id].impactRank,
      );
      expect(new Set(ranks).size, `${band} ranks: ${ranks.join(",")}`).toBe(ranks.length);
    }
  });

  it("carries no order on windfall, which sorts by ticksRemaining instead", () => {
    for (const id of EVENT_TYPE_IDS) {
      if (EVENT_BAND[id].band !== "windfall") continue;
      expect(EVENT_BAND[id].impactRank, `windfall rank: ${id}`).toBe(0);
    }
  });
});
