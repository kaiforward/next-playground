import { describe, it, expect } from "vitest";
import {
  ExperimentConfigSchema,
  experimentToSimConfig,
} from "../simulator/experiment";

describe("ExperimentConfig", () => {
  describe("ExperimentConfigSchema", () => {
    it("accepts a valid minimal config", () => {
      const result = ExperimentConfigSchema.safeParse({
        bots: [{ strategy: "greedy" }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.seed).toBe(42);
        expect(result.data.ticks).toBe(500);
        expect(result.data.bots[0].count).toBe(1);
      }
    });

    it("accepts a full config with all sections", () => {
      const result = ExperimentConfigSchema.safeParse({
        label: "test-experiment",
        seed: 99,
        ticks: 200,
        bots: [
          { strategy: "greedy", count: 2 },
          { strategy: "random", count: 1 },
        ],
        overrides: {
          economy: { reversionRate: 0.1 },
          goods: { food: { basePrice: 30 } },
          fuel: { refuelCostPerUnit: 3 },
        },
        events: {
          disableRandom: true,
          inject: [
            {
              tick: 50,
              target: { economyType: "mining" },
              type: "war",
              severity: 1.5,
            },
          ],
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing bots", () => {
      const result = ExperimentConfigSchema.safeParse({
        ticks: 100,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative ticks", () => {
      const result = ExperimentConfigSchema.safeParse({
        ticks: -1,
        bots: [{ strategy: "greedy" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty bots array", () => {
      const result = ExperimentConfigSchema.safeParse({
        bots: [],
      });
      expect(result.success).toBe(false);
    });

    it("applies defaults for seed and ticks", () => {
      const result = ExperimentConfigSchema.safeParse({
        bots: [{ strategy: "greedy" }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.seed).toBe(42);
        expect(result.data.ticks).toBe(500);
      }
    });

    it("accepts systemIndex injection target", () => {
      const result = ExperimentConfigSchema.safeParse({
        bots: [{ strategy: "greedy" }],
        events: {
          inject: [
            { tick: 10, target: { systemIndex: 5 }, type: "war" },
          ],
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("experimentToSimConfig", () => {
    it("maps config correctly", () => {
      const exp = ExperimentConfigSchema.parse({
        label: "test",
        seed: 99,
        ticks: 200,
        bots: [{ strategy: "greedy", count: 2 }],
        overrides: {
          economy: { reversionRate: 0.1 },
        },
        events: {
          disableRandom: true,
          inject: [
            { tick: 50, target: { economyType: "mining" }, type: "war", severity: 2.0 },
          ],
        },
      });

      const { config, overrides, label } = experimentToSimConfig(exp);

      expect(label).toBe("test");
      expect(config.tickCount).toBe(200);
      expect(config.seed).toBe(99);
      expect(config.bots).toEqual([{ strategy: "greedy", count: 2 }]);
      expect(config.disableRandomEvents).toBe(true);
      expect(config.eventInjections).toHaveLength(1);
      expect(config.eventInjections![0].eventType).toBe("war");
      expect(config.eventInjections![0].severity).toBe(2.0);
      expect(overrides.economy?.reversionRate).toBe(0.1);
    });

    it("returns empty overrides when none specified", () => {
      const exp = ExperimentConfigSchema.parse({
        bots: [{ strategy: "random" }],
      });
      const { overrides } = experimentToSimConfig(exp);
      expect(overrides).toEqual({});
    });

    it("omits eventInjections when empty", () => {
      const exp = ExperimentConfigSchema.parse({
        bots: [{ strategy: "greedy" }],
      });
      const { config } = experimentToSimConfig(exp);
      expect(config.eventInjections).toBeUndefined();
    });
  });
});
