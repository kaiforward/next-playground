import { describe, it, expect } from "vitest";
import { ALERT_CATEGORIES, BUILD_DROP_SEVERITY } from "../alerts";

describe("ALERT_CATEGORIES — hideable is exactly the critical tier", () => {
  it("marks every critical category non-hideable", () => {
    for (const [id, def] of Object.entries(ALERT_CATEGORIES)) {
      if (def.tier !== "critical") continue;
      expect(def.hideable, id).toBe(false);
    }
  });

  it("marks every non-critical category hideable", () => {
    for (const [id, def] of Object.entries(ALERT_CATEGORIES)) {
      if (def.tier === "critical") continue;
      expect(def.hideable, id).toBe(true);
    }
  });
});

describe("ALERT_CATEGORIES — defaults table", () => {
  // Independently named from the spec's defaults table, not read back off ALERT_CATEGORIES — a test
  // that only reflects the object at itself proves nothing.
  const EXPECTED_OFF = new Set(["unrest_rising", "industry_idle", "build_blocked"]);

  it("defaults exactly the three named important categories off", () => {
    for (const [id, def] of Object.entries(ALERT_CATEGORIES)) {
      expect(def.defaultOn, id).toBe(!EXPECTED_OFF.has(id));
    }
  });
});

describe("ALERT_CATEGORIES — order is total within a tier", () => {
  it("gives no two categories in the same tier the same order", () => {
    for (const tier of ["critical", "important", "info"] as const) {
      const orders = Object.entries(ALERT_CATEGORIES)
        .filter(([, def]) => def.tier === tier)
        .map(([, def]) => def.order);
      expect(new Set(orders).size, `${tier} orders: ${orders.join(",")}`).toBe(orders.length);
    }
  });
});

describe("ALERT_CATEGORIES — destinations", () => {
  // Independently transcribed from the spec's own "What a row click does" table, not read back off
  // ALERT_CATEGORIES — the same reason EXPECTED_OFF above is written out by hand. Encoded as
  // "kind:tab" so one table covers all three destination kinds; the system root is "system:".
  const EXPECTED_DESTINATION: Record<string, string> = {
    famine: "system:population",
    strike: "system:population",
    maintenance_unfunded: "faction:",
    crisis: "events:",
    deprived_worlds: "system:population",
    unrest_rising: "system:population",
    survival_stock_falling: "system:logistics",
    demand_unservable: "system:logistics",
    overcrowded: "system:population",
    no_housing_headroom: "system:population",
    build_blocked: "system:industry",
    industry_idle: "system:industry",
    disruption: "events:",
    build_opportunity: "system:industry",
    colony_opportunity: "system:",
    windfall: "events:",
  };

  it("sends every category to the destination the spec's table authored for it", () => {
    // Non-vacuous on the table itself: a missing or misspelled key would silently compare against
    // undefined and pass, so the two key sets are pinned equal first.
    expect(Object.keys(EXPECTED_DESTINATION).sort()).toEqual(Object.keys(ALERT_CATEGORIES).sort());
    for (const [id, def] of Object.entries(ALERT_CATEGORIES)) {
      const actual = def.destination.kind === "system"
        ? `system:${def.destination.tab}`
        : `${def.destination.kind}:`;
      expect(actual, id).toBe(EXPECTED_DESTINATION[id]);
    }
  });
});

describe("BUILD_DROP_SEVERITY", () => {
  it("ranks the five drop reasons worst-first, per the tier-list decision", () => {
    expect(BUILD_DROP_SEVERITY["no-capacity"]).toBeLessThan(BUILD_DROP_SEVERITY["no-input-supplier"]);
    expect(BUILD_DROP_SEVERITY["no-input-supplier"]).toBeLessThan(BUILD_DROP_SEVERITY["no-consumer"]);
    expect(BUILD_DROP_SEVERITY["no-consumer"]).toBeLessThan(BUILD_DROP_SEVERITY["no-labour"]);
    expect(BUILD_DROP_SEVERITY["no-labour"]).toBeLessThan(BUILD_DROP_SEVERITY["no-whole-level"]);
  });

  it("gives every reason a unique rank", () => {
    const ranks = Object.values(BUILD_DROP_SEVERITY);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});
