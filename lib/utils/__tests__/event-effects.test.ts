import { describe, it, expect } from "vitest";
import type {
  EventPhaseDefinition,
  ModifierTemplate,
} from "@/lib/constants/events";
import { summarizePhaseEffects } from "@/lib/utils/event-effects";

/** Build a minimal phase carrying only the modifiers under test. */
function phase(modifiers: ModifierTemplate[]): EventPhaseDefinition {
  return {
    name: "test_phase",
    displayName: "Test Phase",
    durationRange: [10, 20],
    modifiers,
  };
}

function anchor(value: number, goodId: string | null): ModifierTemplate {
  return {
    domain: "economy",
    type: "anchor_shift",
    target: "system",
    goodId,
    parameter: "target_stock",
    value,
  };
}

describe("summarizePhaseEffects", () => {
  describe("anchor shifts", () => {
    it("surfaces a per-good anchor up (>1) as 'X demand up'", () => {
      expect(summarizePhaseEffects(phase([anchor(1.5, "fuel")]))).toBe(
        "Fuel demand up",
      );
    });

    it("surfaces a per-good anchor down (<1) as 'X demand down'", () => {
      expect(summarizePhaseEffects(phase([anchor(0.56, "ore")]))).toBe(
        "Ore demand down",
      );
    });

    it("surfaces a null-goodId anchor up as 'All demand up'", () => {
      expect(summarizePhaseEffects(phase([anchor(3.0, null)]))).toBe(
        "All demand up",
      );
    });

    it("surfaces a null-goodId anchor down as 'All demand down'", () => {
      expect(summarizePhaseEffects(phase([anchor(0.5, null)]))).toBe(
        "All demand down",
      );
    });

    it("merges multiple same-direction goods into one phrase", () => {
      expect(
        summarizePhaseEffects(phase([anchor(1.6, "food"), anchor(1.4, "medicine")])),
      ).toBe("Food, Medicine demand up");
    });

    it("treats an identity anchor (value === 1) as no demand change", () => {
      expect(summarizePhaseEffects(phase([anchor(1, "fuel")]))).toBe(
        "Minor market effects",
      );
    });

    it("dedupes: a null-goodId 'All demand up' suppresses redundant per-good up phrases", () => {
      // pirate_raid shape: all-goods anchor up + weapons anchor up.
      const result = summarizePhaseEffects(
        phase([anchor(1.67, null), anchor(2.0, "weapons")]),
      );
      expect(result).toBe("All demand up");
      expect(result).not.toContain("Weapons");
    });

    it("keeps opposite-direction per-good phrases alongside an all-goods phrase", () => {
      // "All demand down" does not suppress a per-good *up* phrase.
      expect(
        summarizePhaseEffects(phase([anchor(0.5, null), anchor(1.5, "fuel")])),
      ).toBe("All demand down · Fuel demand up");
    });
  });

  describe("rate multipliers", () => {
    it("surfaces production_rate < 1 as 'Production slowed'", () => {
      const mod: ModifierTemplate = {
        domain: "economy",
        type: "rate_multiplier",
        target: "system",
        goodId: null,
        parameter: "production_rate",
        value: 0.5,
      };
      expect(summarizePhaseEffects(phase([mod]))).toBe("Production slowed");
    });

    it("surfaces production_rate > 1 as 'Production boosted'", () => {
      const mod: ModifierTemplate = {
        domain: "economy",
        type: "rate_multiplier",
        target: "system",
        goodId: "electronics",
        parameter: "production_rate",
        value: 2.5,
      };
      expect(summarizePhaseEffects(phase([mod]))).toBe("Production boosted");
    });
  });

  describe("navigation", () => {
    it("surfaces any navigation modifier as 'Danger increased'", () => {
      const danger: ModifierTemplate = {
        domain: "navigation",
        type: "equilibrium_shift",
        target: "system",
        parameter: "danger_level",
        value: 0.08,
      };
      expect(summarizePhaseEffects(phase([danger]))).toBe("Danger increased");
    });
  });

  describe("composition and edge cases", () => {
    it("joins multiple effect categories with ' · ' in a stable order", () => {
      const danger: ModifierTemplate = {
        domain: "navigation",
        type: "equilibrium_shift",
        target: "system",
        parameter: "danger_level",
        value: 0.2,
      };
      const production: ModifierTemplate = {
        domain: "economy",
        type: "rate_multiplier",
        target: "system",
        goodId: null,
        parameter: "production_rate",
        value: 0.2,
      };
      expect(
        summarizePhaseEffects(phase([anchor(2.5, "fuel"), production, danger])),
      ).toBe("Fuel demand up · Production slowed · Danger increased");
    });

    it("returns 'Minor market effects' when no recognized modifiers are present", () => {
      expect(summarizePhaseEffects(phase([]))).toBe("Minor market effects");
    });

    it("ignores legacy economy modifier types (regression guard for the removed supply/demand_target paths)", () => {
      // Post-anchor-shift, an economy equilibrium_shift has no summary branch and
      // must be silently ignored rather than producing supply/demand wording.
      const legacy: ModifierTemplate = {
        domain: "economy",
        type: "equilibrium_shift",
        target: "system",
        goodId: "ore",
        parameter: "supply_target",
        value: 1.8,
      };
      expect(summarizePhaseEffects(phase([legacy]))).toBe("Minor market effects");
    });
  });
});
