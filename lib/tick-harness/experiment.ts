/**
 * Experiment system — YAML config parsing, validation, and result serialization.
 *
 * The calibration harness is now a thin wrapper over `generateWorld` +
 * `runWorldTick` (see `docs/build-plans/pivot-phase2-engine-extraction.md`
 * Task 5): there is no per-run constants-override channel any more —
 * `runWorldTick` reads the same code constants the live game does — so an
 * experiment config only names the world to generate and how long to run it.
 */

import { z } from "zod";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import type { SimConfig, SimResults } from "./types";

// ── Zod schema ───────────────────────────────────────────────────

export const ExperimentConfigSchema = z.object({
  label: z.string().optional(),
  seed: z.number().int().default(42),
  ticks: z.number().int().min(1).default(500),
  systemCount: z.number().int().min(1).default(DEFAULT_SYSTEM_COUNT),
});

export type ExperimentConfig = z.infer<typeof ExperimentConfigSchema>;

// ── Conversion ───────────────────────────────────────────────────

/** Convert a validated experiment config to SimConfig. */
export function experimentToSimConfig(exp: ExperimentConfig): {
  config: SimConfig;
  label?: string;
} {
  return {
    config: { systemCount: exp.systemCount, seed: exp.seed, tickCount: exp.ticks },
    label: exp.label,
  };
}

// ── Result serialization ─────────────────────────────────────────

export interface ExperimentResult {
  label?: string;
  timestamp: string;
  config: SimConfig;
  marketHealth: SimResults["marketHealth"];
  eventImpacts: SimResults["eventImpacts"];
  elapsedMs: number;
}

/**
 * Wrap SimResults into a self-documenting experiment result for saving.
 */
export function buildExperimentResult(results: SimResults): ExperimentResult {
  return {
    label: results.label,
    timestamp: new Date().toISOString(),
    config: results.config,
    marketHealth: results.marketHealth,
    eventImpacts: results.eventImpacts,
    elapsedMs: results.elapsedMs,
  };
}
