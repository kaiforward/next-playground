/**
 * Experiment config parsing and SimConstantOverrides propagation.
 */

import { describe, it, expect } from "vitest";
import { ExperimentConfigSchema, experimentToSimConfig } from "@/lib/engine/simulator/experiment";
import { resolveConstants } from "@/lib/engine/simulator/constants";
import { ECONOMY_UPDATE_INTERVAL } from "@/lib/constants/tick-cadence";

describe("experimentToSimConfig — economy.interval override", () => {
  it("resolves to the overridden interval when economy.interval is set in config", () => {
    const raw = {
      ticks: 100,
      bots: [{ strategy: "greedy", count: 1 }],
      overrides: {
        economy: { interval: 60 },
      },
    };

    const exp = ExperimentConfigSchema.parse(raw);
    const { overrides } = experimentToSimConfig(exp);
    const constants = resolveConstants(overrides);

    expect(constants.economy.interval).toBe(60);
  });

  it("resolves to ECONOMY_UPDATE_INTERVAL when no economy.interval override is given", () => {
    const raw = {
      ticks: 100,
      bots: [{ strategy: "greedy", count: 1 }],
    };

    const exp = ExperimentConfigSchema.parse(raw);
    const { overrides } = experimentToSimConfig(exp);
    const constants = resolveConstants(overrides);

    expect(constants.economy.interval).toBe(ECONOMY_UPDATE_INTERVAL);
  });

  it("preserves noiseFraction alongside interval override", () => {
    const raw = {
      ticks: 100,
      bots: [{ strategy: "greedy", count: 1 }],
      overrides: {
        economy: { interval: 60, noiseFraction: 0.1 },
      },
    };

    const exp = ExperimentConfigSchema.parse(raw);
    const { overrides } = experimentToSimConfig(exp);
    const constants = resolveConstants(overrides);

    expect(constants.economy.interval).toBe(60);
    expect(constants.economy.noiseFraction).toBe(0.1);
  });

  it("rejects interval < 1", () => {
    const raw = {
      ticks: 100,
      bots: [{ strategy: "greedy", count: 1 }],
      overrides: {
        economy: { interval: 0 },
      },
    };

    expect(() => ExperimentConfigSchema.parse(raw)).toThrow();
  });
});
