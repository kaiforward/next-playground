/**
 * Pure event engine — deterministic functions for event lifecycle management.
 * No DB or constant imports. All randomness injected via `rng` parameter.
 */

import { clamp } from "@/lib/utils/math";
import type {
  EventDefinition,
  EventPhaseDefinition,
  EventTypeId,
} from "@/lib/constants/events";

// ── Types ───────────────────────────────────────────────────────

/** Minimal event representation for pure functions. */
export interface EventSnapshot {
  id: string;
  type: EventTypeId;
  phase: string;
  systemId: string | null;
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
}

/** Result of a phase transition check. */
export type PhaseTransitionResult = "none" | "advance" | "expire";

/** A modifier row ready for DB insertion (no id/eventId — caller assigns). */
export interface ModifierRow {
  domain: string;
  type: string;
  targetType: string;
  targetId: string | null;
  goodId: string | null;
  parameter: string;
  value: number;
}

/** Aggregated modifier effects for a single market entry. */
export interface AggregatedModifiers {
  /** Compound multiplier on the good's pricing anchor (targetStock). Default 1. */
  anchorMult: number;
  productionMult: number;
  consumptionMult: number;
}

/** Caps applied during aggregation. */
export interface ModifierCaps {
  minAnchorMult: number;
  maxAnchorMult: number;
  minMultiplier: number;
  maxMultiplier: number;
}

// ── Phase transitions ───────────────────────────────────────────

/**
 * Check whether an event should advance to its next phase or expire.
 *
 * Returns "advance" if the current phase duration has elapsed and there are
 * more phases. Returns "expire" if all phases are complete. Otherwise "none".
 */
export function checkPhaseTransition(
  event: EventSnapshot,
  tick: number,
  definition: EventDefinition,
): PhaseTransitionResult {
  const elapsed = tick - event.phaseStartTick;
  if (elapsed < event.phaseDuration) return "none";

  const phaseIndex = definition.phases.findIndex((p) => p.name === event.phase);
  if (phaseIndex < 0) return "expire"; // unknown phase — clean up

  if (phaseIndex < definition.phases.length - 1) return "advance";
  return "expire";
}

// ── Modifier building ───────────────────────────────────────────

/**
 * Build concrete modifier rows for a given phase, resolving "system"/"region"
 * targets to actual IDs.
 */
export function buildModifiersForPhase(
  phase: EventPhaseDefinition,
  systemId: string | null,
  regionId: string | null,
): ModifierRow[] {
  return phase.modifiers.map((template) => {
    const targetId = template.target === "system" ? systemId : regionId;
    return {
      domain: template.domain,
      type: template.type,
      targetType: template.target,
      targetId,
      goodId: template.goodId ?? null,
      parameter: template.parameter,
      value: template.value,
    };
  });
}

// ── Modifier aggregation ────────────────────────────────────────

/**
 * Aggregate a list of active modifiers into a single effect bundle.
 *
 * Filters to modifiers matching `goodId` (including null goodId which applies
 * to all goods). Anchor shifts compound (multiply); rate multipliers compound.
 * Safety caps applied at the end.
 */
export function aggregateModifiers(
  modifiers: ModifierRow[],
  goodId: string,
  caps: ModifierCaps,
): AggregatedModifiers {
  let anchorMult = 1;
  let productionMult = 1;
  let consumptionMult = 1;

  for (const mod of modifiers) {
    // Match: modifier applies to this good specifically, or to all goods (null)
    if (mod.goodId !== null && mod.goodId !== goodId) continue;

    if (mod.type === "anchor_shift") {
      if (mod.parameter === "target_stock") anchorMult *= mod.value;
    } else if (mod.type === "rate_multiplier") {
      if (mod.parameter === "production_rate") productionMult *= mod.value;
      else if (mod.parameter === "consumption_rate") consumptionMult *= mod.value;
    }
  }

  return {
    anchorMult: clamp(anchorMult, caps.minAnchorMult, caps.maxAnchorMult),
    productionMult: clamp(productionMult, caps.minMultiplier, caps.maxMultiplier),
    consumptionMult: clamp(consumptionMult, caps.minMultiplier, caps.maxMultiplier),
  };
}

// ── Phase duration ──────────────────────────────────────────────

/**
 * Roll a phase duration from a [min, max] range using injected RNG.
 */
export function rollPhaseDuration(
  range: [number, number],
  rng: () => number,
): number {
  const [min, max] = range;
  if (min > max) throw new Error(`Invalid duration range: [${min}, ${max}]`);
  return Math.floor(min + rng() * (max - min + 1));
}
