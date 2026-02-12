/**
 * Pure event engine — deterministic functions for event lifecycle management.
 * No DB or constant imports. All randomness injected via `rng` parameter.
 */

import type {
  EventDefinition,
  EventPhaseDefinition,
  ModifierTemplate,
  SpreadRule,
} from "@/lib/constants/events";

// ── Types ───────────────────────────────────────────────────────

/** Minimal event representation for pure functions. */
export interface EventSnapshot {
  id: string;
  type: string;
  phase: string;
  systemId: string | null;
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  severity: number;
  sourceEventId: string | null;
}

/** Minimal system representation for spawn selection. */
export interface SystemSnapshot {
  id: string;
  economyType: string;
  regionId: string;
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
  supplyTargetShift: number;
  demandTargetShift: number;
  productionMult: number;
  consumptionMult: number;
  reversionMult: number;
}

/** Decision to spawn a new event. */
export interface SpawnDecision {
  type: string;
  systemId: string;
  regionId: string;
  phase: string;
  phaseDuration: number;
  severity: number;
}

/** Caps applied during aggregation. */
export interface ModifierCaps {
  maxShift: number;
  minMultiplier: number;
  maxMultiplier: number;
  minReversionMult: number;
}

/** Spawn constraints. */
export interface SpawnCaps {
  maxEventsGlobal: number;
  maxEventsPerSystem: number;
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
 * Scale a modifier template value by event severity.
 *
 * - Shifts: linear scaling (`value × severity`)
 * - Multipliers/dampening: lerp toward 1.0 (`1 + (value - 1) × severity`)
 */
function scaleValue(
  template: ModifierTemplate,
  severity: number,
): number {
  if (template.type === "equilibrium_shift") {
    return template.value * severity;
  }
  // rate_multiplier and reversion_dampening: lerp toward 1.0
  return 1 + (template.value - 1) * severity;
}

/**
 * Build concrete modifier rows for a given phase.
 *
 * Resolves "system"/"region" targets to actual IDs and applies severity scaling.
 */
export function buildModifiersForPhase(
  phase: EventPhaseDefinition,
  systemId: string | null,
  regionId: string | null,
  severity: number,
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
      value: scaleValue(template, severity),
    };
  });
}

// ── Modifier aggregation ────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Aggregate a list of active modifiers into a single effect bundle.
 *
 * Filters to modifiers matching `goodId` (including null goodId which applies
 * to all goods). Shifts sum, multipliers multiply, dampening takes min.
 * Safety caps applied at the end.
 */
export function aggregateModifiers(
  modifiers: ModifierRow[],
  goodId: string,
  caps: ModifierCaps,
): AggregatedModifiers {
  let supplyTargetShift = 0;
  let demandTargetShift = 0;
  let productionMult = 1;
  let consumptionMult = 1;
  let reversionMult = 1;

  for (const mod of modifiers) {
    // Match: modifier applies to this good specifically, or to all goods (null)
    if (mod.goodId !== null && mod.goodId !== goodId) continue;

    if (mod.type === "equilibrium_shift") {
      if (mod.parameter === "supply_target") supplyTargetShift += mod.value;
      else if (mod.parameter === "demand_target") demandTargetShift += mod.value;
    } else if (mod.type === "rate_multiplier") {
      if (mod.parameter === "production_rate") productionMult *= mod.value;
      else if (mod.parameter === "consumption_rate") consumptionMult *= mod.value;
    } else if (mod.type === "reversion_dampening") {
      if (mod.parameter === "reversion_rate") reversionMult = Math.min(reversionMult, mod.value);
    }
  }

  return {
    supplyTargetShift: clamp(supplyTargetShift, -caps.maxShift, caps.maxShift),
    demandTargetShift: clamp(demandTargetShift, -caps.maxShift, caps.maxShift),
    productionMult: clamp(productionMult, caps.minMultiplier, caps.maxMultiplier),
    consumptionMult: clamp(consumptionMult, caps.minMultiplier, caps.maxMultiplier),
    reversionMult: clamp(reversionMult, caps.minReversionMult, 1.0),
  };
}

// ── Spawn selection ─────────────────────────────────────────────

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

/**
 * Select an event to spawn (or null if nothing should spawn).
 *
 * Checks: global cap, per-type cap, per-system cap, cooldown.
 * Filters systems by economy type. Weighted random selection among eligible
 * (definition, system) pairs.
 */
export function selectEventToSpawn(
  definitions: Record<string, EventDefinition>,
  activeEvents: EventSnapshot[],
  systems: SystemSnapshot[],
  tick: number,
  caps: SpawnCaps,
  rng: () => number,
): SpawnDecision | null {
  // Global cap check
  if (activeEvents.length >= caps.maxEventsGlobal) return null;

  // Build per-type count and per-system count
  const typeCount = new Map<string, number>();
  const systemCount = new Map<string, number>();
  const systemTypeLastEnd = new Map<string, number>(); // "systemId:type" → latest startTick

  for (const ev of activeEvents) {
    typeCount.set(ev.type, (typeCount.get(ev.type) ?? 0) + 1);
    if (ev.systemId) {
      systemCount.set(ev.systemId, (systemCount.get(ev.systemId) ?? 0) + 1);
    }
    // Track last start tick for cooldown checking (rough proxy — events that
    // started most recently are most relevant for cooldown)
    if (ev.systemId) {
      const key = `${ev.systemId}:${ev.type}`;
      const prev = systemTypeLastEnd.get(key) ?? 0;
      if (ev.startTick > prev) systemTypeLastEnd.set(key, ev.startTick);
    }
  }

  // Build eligible (definition, system) candidates
  interface Candidate {
    definition: EventDefinition;
    system: SystemSnapshot;
    weight: number;
  }
  const candidates: Candidate[] = [];

  for (const def of Object.values(definitions)) {
    // Skip non-spawnable definitions (child events with weight 0)
    if (def.weight <= 0) continue;

    // Per-type cap
    if ((typeCount.get(def.type) ?? 0) >= def.maxActive) continue;

    for (const sys of systems) {
      // Economy type filter
      if (def.targetFilter?.economyTypes) {
        if (!def.targetFilter.economyTypes.includes(sys.economyType as never)) continue;
      }

      // Per-system cap
      if ((systemCount.get(sys.id) ?? 0) >= caps.maxEventsPerSystem) continue;

      // Cooldown: no same event type at same system within cooldown ticks
      const cooldownKey = `${sys.id}:${def.type}`;
      const lastStart = systemTypeLastEnd.get(cooldownKey);
      if (lastStart !== undefined && tick - lastStart < def.cooldown) continue;

      candidates.push({ definition: def, system: sys, weight: def.weight });
    }
  }

  if (candidates.length === 0) return null;

  // Weighted random selection
  const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
  let roll = rng() * totalWeight;

  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll <= 0) {
      const firstPhase = candidate.definition.phases[0];
      return {
        type: candidate.definition.type,
        systemId: candidate.system.id,
        regionId: candidate.system.regionId,
        phase: firstPhase.name,
        phaseDuration: rollPhaseDuration(firstPhase.durationRange, rng),
        severity: 1.0,
      };
    }
  }

  // Fallback (shouldn't reach here, but handle floating-point edge cases)
  const last = candidates[candidates.length - 1];
  const firstPhase = last.definition.phases[0];
  return {
    type: last.definition.type,
    systemId: last.system.id,
    regionId: last.system.regionId,
    phase: firstPhase.name,
    phaseDuration: rollPhaseDuration(firstPhase.durationRange, rng),
    severity: 1.0,
  };
}

// ── Shock building ──────────────────────────────────────────────

/** A market shock ready for application (severity-scaled). */
export interface ShockRow {
  goodId: string;
  parameter: "supply" | "demand";
  value: number;
}

/**
 * Build severity-scaled shock deltas for a phase.
 * Returns empty array if the phase has no shocks.
 */
export function buildShocksForPhase(
  phase: EventPhaseDefinition,
  severity: number,
): ShockRow[] {
  if (!phase.shocks || phase.shocks.length === 0) return [];
  return phase.shocks.map((s) => ({
    goodId: s.goodId,
    parameter: s.parameter,
    value: Math.round(s.value * severity) || 0, // Avoid -0
  }));
}

// ── Spread evaluation ───────────────────────────────────────────

/** Neighbor system info for spread evaluation. */
export interface NeighborSnapshot {
  id: string;
  economyType: string;
  regionId: string;
}

/**
 * Evaluate spread rules and return spawn decisions for neighboring systems.
 *
 * Logic per rule:
 * 1. Filter neighbors by targetFilter (sameRegion, economyTypes)
 * 2. Skip neighbors at per-system cap
 * 3. Skip neighbors that already have the child event type active
 * 4. Roll probability per eligible neighbor
 * 5. Return SpawnDecision with severity = rule.severity × source severity
 */
export function evaluateSpreadTargets(
  rules: SpreadRule[],
  sourceEvent: EventSnapshot,
  neighbors: NeighborSnapshot[],
  activeEvents: EventSnapshot[],
  caps: SpawnCaps,
  definitions: Record<string, EventDefinition>,
  rng: () => number,
): SpawnDecision[] {
  const decisions: SpawnDecision[] = [];

  // Pre-compute per-system event counts and active event types per system
  const systemEventCount = new Map<string, number>();
  const systemActiveTypes = new Map<string, Set<string>>();
  for (const ev of activeEvents) {
    if (ev.systemId) {
      systemEventCount.set(ev.systemId, (systemEventCount.get(ev.systemId) ?? 0) + 1);
      if (!systemActiveTypes.has(ev.systemId)) {
        systemActiveTypes.set(ev.systemId, new Set());
      }
      systemActiveTypes.get(ev.systemId)!.add(ev.type);
    }
  }

  for (const rule of rules) {
    const childDef = definitions[rule.eventType];
    if (!childDef) continue;

    for (const neighbor of neighbors) {
      // Filter: sameRegion
      if (rule.targetFilter?.sameRegion && neighbor.regionId !== sourceEvent.regionId) {
        continue;
      }

      // Filter: economyTypes
      if (rule.targetFilter?.economyTypes) {
        if (!rule.targetFilter.economyTypes.includes(neighbor.economyType as never)) {
          continue;
        }
      }

      // Skip: per-system cap
      if ((systemEventCount.get(neighbor.id) ?? 0) >= caps.maxEventsPerSystem) {
        continue;
      }

      // Skip: child event type already active at this neighbor
      if (systemActiveTypes.get(neighbor.id)?.has(rule.eventType)) {
        continue;
      }

      // Roll probability
      if (rng() >= rule.probability) continue;

      const firstPhase = childDef.phases[0];
      decisions.push({
        type: rule.eventType,
        systemId: neighbor.id,
        regionId: neighbor.regionId,
        phase: firstPhase.name,
        phaseDuration: rollPhaseDuration(firstPhase.durationRange, rng),
        severity: rule.severity * sourceEvent.severity,
      });
    }
  }

  return decisions;
}
