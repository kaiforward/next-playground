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
  // Independently named from the spec's defaults table (alert-bar.md:244-252), not read back off
  // ALERT_CATEGORIES — a test that only reflects the object at itself proves nothing.
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

describe("ALERT_CATEGORIES — destination tab", () => {
  it("gives a system tab only to a system destination", () => {
    for (const [id, def] of Object.entries(ALERT_CATEGORIES)) {
      if (def.destination.kind === "system") continue;
      expect("tab" in def.destination, id).toBe(false);
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
