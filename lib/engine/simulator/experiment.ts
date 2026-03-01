/**
 * Experiment system — YAML config parsing, validation, and result serialization.
 */

import { z } from "zod";
import { toEventTypeId } from "@/lib/types/guards";
import type { SimConfig, SimResults, EventInjection, InjectionTarget } from "./types";
import type { SimConstantOverrides } from "./constants";

// ── Zod schemas ──────────────────────────────────────────────────

const InjectionTargetSchema = z.union([
  z.object({ economyType: z.string(), nth: z.number().int().min(0).optional() }),
  z.object({ systemIndex: z.number().int().min(0) }),
]);

const EventInjectionSchema = z.object({
  tick: z.number().int().min(0),
  target: InjectionTargetSchema,
  type: z.string(),
  severity: z.number().positive().optional(),
});

const BotConfigSchema = z.object({
  strategy: z.string(),
  count: z.number().int().min(1).default(1),
});

const ConstantOverridesSchema = z.object({
  economy: z.object({
    reversionRate: z.number().optional(),
    noiseAmplitude: z.number().optional(),
    minLevel: z.number().optional(),
    maxLevel: z.number().optional(),
    productionRate: z.number().optional(),
    consumptionRate: z.number().optional(),
  }).optional(),
  equilibrium: z.object({
    produces: z.object({ supply: z.number().optional(), demand: z.number().optional() }).optional(),
    consumes: z.object({ supply: z.number().optional(), demand: z.number().optional() }).optional(),
    neutral: z.object({ supply: z.number().optional(), demand: z.number().optional() }).optional(),
  }).optional(),
  goods: z.record(z.string(), z.object({ basePrice: z.number() })).optional(),
  fuel: z.object({
    refuelCostPerUnit: z.number().optional(),
  }).optional(),
  events: z.object({
    spawnInterval: z.number().int().min(1).optional(),
    maxPerSystem: z.number().int().min(1).optional(),
    maxGlobal: z.number().int().min(1).optional(),
    modifierCaps: z.object({
      maxShift: z.number().optional(),
      minMultiplier: z.number().optional(),
      maxMultiplier: z.number().optional(),
      minReversionMult: z.number().optional(),
    }).optional(),
  }).optional(),
  ships: z.record(z.string(), z.object({
    fuel: z.number().optional(),
    cargo: z.number().optional(),
    price: z.number().optional(),
  })).optional(),
  universe: z.object({
    regionCount: z.number().int().min(1).optional(),
    totalSystems: z.number().int().min(1).optional(),
    intraRegionBaseFuel: z.number().optional(),
    gatewayFuelMultiplier: z.number().optional(),
    gatewaysPerBorder: z.number().int().min(1).optional(),
    intraRegionExtraEdges: z.number().optional(),
  }).optional(),
  bots: z.object({
    startingCredits: z.number().optional(),
    refuelThreshold: z.number().optional(),
    tradeImpactFactor: z.number().optional(),
  }).optional(),
}).optional();

const EventsConfigSchema = z.object({
  disableRandom: z.boolean().default(false),
  inject: z.array(EventInjectionSchema).default([]),
}).optional();

export const ExperimentConfigSchema = z.object({
  label: z.string().optional(),
  seed: z.number().int().default(42),
  ticks: z.number().int().min(1).default(500),
  bots: z.array(BotConfigSchema).min(1),
  overrides: ConstantOverridesSchema,
  events: EventsConfigSchema,
});

export type ExperimentConfig = z.infer<typeof ExperimentConfigSchema>;

// ── Conversion ───────────────────────────────────────────────────

/**
 * Convert a validated experiment config to SimConfig + overrides.
 */
export function experimentToSimConfig(exp: ExperimentConfig): {
  config: SimConfig;
  overrides: SimConstantOverrides;
  label?: string;
} {
  const injections: EventInjection[] = (exp.events?.inject ?? []).map((inj) => {
    // Zod validates structure — narrow the union via property checks
    const target: InjectionTarget = "systemIndex" in inj.target
      ? { systemIndex: inj.target.systemIndex }
      : { economyType: inj.target.economyType, nth: inj.target.nth };
    return { tick: inj.tick, target, eventType: toEventTypeId(inj.type), severity: inj.severity };
  });

  const config: SimConfig = {
    tickCount: exp.ticks,
    bots: exp.bots,
    seed: exp.seed,
    eventInjections: injections.length > 0 ? injections : undefined,
    disableRandomEvents: exp.events?.disableRandom ?? false,
  };

  // Zod validates the shape — construct with explicit fields to satisfy the type
  const overrides: SimConstantOverrides = exp.overrides ?? {};

  return { config, overrides, label: exp.label };
}

// ── Result serialization ─────────────────────────────────────────

export interface ExperimentResult {
  label?: string;
  timestamp: string;
  config: SimConfig;
  constants: SimResults["constants"];
  overrides: SimResults["overrides"];
  summaries: SimResults["summaries"];
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
    constants: results.constants,
    overrides: results.overrides,
    summaries: results.summaries,
    marketHealth: results.marketHealth,
    eventImpacts: results.eventImpacts,
    elapsedMs: results.elapsedMs,
  };
}
