import { describe, it, expect } from "vitest";
import {
  ExperimentConfigSchema,
  experimentToHarnessConfig,
} from "../experiment";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";

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

    it("omits label when none is specified", () => {
      const exp = ExperimentConfigSchema.parse({});
      const { label } = experimentToHarnessConfig(exp);
      expect(label).toBeUndefined();
    });
  });
});
