/**
 * Experiment system — YAML config parsing, validation, and result serialization.
 *
 * The calibration harness is a thin wrapper over `generateWorld` +
 * `runWorldTick`: there is no per-run constants-override channel —
 * `runWorldTick` reads the same code constants the live game does — so an
 * experiment config only names the world to generate and how long to run it.
 */

import { z } from "zod";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import type { HarnessConfig, HarnessResults } from "./types";

// ── Zod schema ───────────────────────────────────────────────────

export const ExperimentConfigSchema = z.object({
  label: z.string().optional(),
  seed: z.number().int().default(42),
  ticks: z.number().int().min(1).default(500),
  systemCount: z.number().int().min(1).default(DEFAULT_SYSTEM_COUNT),
});

export type ExperimentConfig = z.infer<typeof ExperimentConfigSchema>;

// ── Conversion ───────────────────────────────────────────────────

/** Convert a validated experiment config to HarnessConfig. */
export function experimentToHarnessConfig(exp: ExperimentConfig): {
  config: HarnessConfig;
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
  config: HarnessConfig;
  /** The scale the run resolved at — a saved result is unreadable without knowing it. */
  economyScale: number;
  marketHealth: HarnessResults["marketHealth"];
  eventImpacts: HarnessResults["eventImpacts"];
  elapsedMs: number;
}

/**
 * Wrap HarnessResults into a self-documenting experiment result for saving.
 */
export function buildExperimentResult(results: HarnessResults): ExperimentResult {
  return {
    label: results.label,
    timestamp: new Date().toISOString(),
    config: results.config,
    economyScale: results.economyScale,
    marketHealth: results.marketHealth,
    eventImpacts: results.eventImpacts,
    elapsedMs: results.elapsedMs,
  };
}
