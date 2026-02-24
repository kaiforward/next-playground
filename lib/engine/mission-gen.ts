/**
 * Pure mission generation engine — operational mission candidates.
 * No DB dependency. All randomness injected via `rng` parameter.
 */

import {
  type MissionType,
  MISSION_TYPE_DEFS,
  SURVEY_ELIGIBLE_TRAITS,
  OP_MISSION_DEADLINE_TICKS,
} from "@/lib/constants/missions";
import { getEnemyTier, type EnemyTier } from "@/lib/constants/combat";
import type { TraitId, QualityTier } from "@/lib/types/game";

// ── Types ────────────────────────────────────────────────────────

export interface SystemSnapshot {
  id: string;
  name: string;
  traits: Array<{ traitId: TraitId; quality: QualityTier }>;
}

export interface OpMissionCandidate {
  type: MissionType;
  systemId: string;
  targetSystemId: string;
  reward: number;
  deadlineTick: number;
  durationTicks: number | null;
  enemyTier: EnemyTier | null;
  statRequirements: Record<string, number>;
}

// ── Reward calculation ──────────────────────────────────────────

/** Interpolate reward within range based on a 0-1 factor. */
function interpolateReward(
  range: [min: number, max: number],
  factor: number,
): number {
  const clamped = Math.max(0, Math.min(1, factor));
  return Math.round(range[0] + (range[1] - range[0]) * clamped);
}

// ── Patrol candidates ───────────────────────────────────────────

/**
 * Systems with danger > threshold generate patrol missions.
 * Higher danger = higher reward.
 */
export function selectPatrolCandidates(
  systems: SystemSnapshot[],
  dangerLevels: Map<string, number>,
  tick: number,
  rng: () => number,
): OpMissionCandidate[] {
  const def = MISSION_TYPE_DEFS.patrol;
  const candidates: OpMissionCandidate[] = [];

  for (const system of systems) {
    const danger = dangerLevels.get(system.id) ?? 0;
    if (danger < def.dangerThreshold) continue;

    // Generation probability scales with danger
    if (rng() > danger * 2) continue;

    const [minDur, maxDur] = def.durationTicks!;
    const durationTicks = minDur + Math.floor(rng() * (maxDur - minDur + 1));

    // Reward scales with danger (normalize to 0-1 factor)
    const dangerFactor = Math.min(1, danger / 0.5);
    const reward = interpolateReward(def.rewardRange, dangerFactor);

    candidates.push({
      type: "patrol",
      systemId: system.id,
      targetSystemId: system.id, // patrol at same system
      reward,
      deadlineTick: tick + OP_MISSION_DEADLINE_TICKS,
      durationTicks,
      enemyTier: null,
      statRequirements: { ...def.statGate },
    });
  }

  return candidates;
}

// ── Survey candidates ───────────────────────────────────────────

/**
 * Systems with specific survey-eligible traits generate survey missions.
 * Trait quality affects reward.
 */
export function selectSurveyCandidates(
  systems: SystemSnapshot[],
  tick: number,
  rng: () => number,
): OpMissionCandidate[] {
  const def = MISSION_TYPE_DEFS.survey;
  const candidates: OpMissionCandidate[] = [];

  const eligibleTraits = new Set<string>(SURVEY_ELIGIBLE_TRAITS);

  for (const system of systems) {
    const surveyTraits = system.traits.filter((t) =>
      eligibleTraits.has(t.traitId),
    );
    if (surveyTraits.length === 0) continue;

    // Generation probability: 15% per eligible trait per cycle
    if (rng() > 0.15 * surveyTraits.length) continue;

    const [minDur, maxDur] = def.durationTicks!;
    const durationTicks = minDur + Math.floor(rng() * (maxDur - minDur + 1));

    // Reward scales with max trait quality
    const maxQuality = Math.max(...surveyTraits.map((t) => t.quality));
    const qualityFactor = (maxQuality - 1) / 2; // 1→0, 2→0.5, 3→1.0
    const reward = interpolateReward(def.rewardRange, qualityFactor);

    candidates.push({
      type: "survey",
      systemId: system.id,
      targetSystemId: system.id,
      reward,
      deadlineTick: tick + OP_MISSION_DEADLINE_TICKS,
      durationTicks,
      enemyTier: null,
      statRequirements: { ...def.statGate },
    });
  }

  return candidates;
}

// ── Bounty candidates ───────────────────────────────────────────

/**
 * Systems with danger > threshold generate bounty missions.
 * Higher danger = tougher enemies = higher reward.
 */
export function selectBountyCandidates(
  systems: SystemSnapshot[],
  dangerLevels: Map<string, number>,
  tick: number,
  rng: () => number,
): OpMissionCandidate[] {
  const def = MISSION_TYPE_DEFS.bounty;
  const candidates: OpMissionCandidate[] = [];

  for (const system of systems) {
    const danger = dangerLevels.get(system.id) ?? 0;
    if (danger < def.dangerThreshold) continue;

    // Generation probability scales with danger
    if (rng() > danger * 1.5) continue;

    const enemyTier = getEnemyTier(danger);

    // Reward scales with danger
    const dangerFactor = Math.min(1, danger / 0.5);
    const reward = interpolateReward(def.rewardRange, dangerFactor);

    candidates.push({
      type: "bounty",
      systemId: system.id,
      targetSystemId: system.id,
      reward,
      deadlineTick: tick + OP_MISSION_DEADLINE_TICKS,
      durationTicks: null,
      enemyTier,
      statRequirements: { ...def.statGate },
    });
  }

  return candidates;
}

// ── Combined generation ─────────────────────────────────────────

/**
 * Generate all operational mission candidates for the current tick.
 */
export function generateOpMissionCandidates(
  systems: SystemSnapshot[],
  dangerLevels: Map<string, number>,
  tick: number,
  rng: () => number,
): OpMissionCandidate[] {
  return [
    ...selectPatrolCandidates(systems, dangerLevels, tick, rng),
    ...selectSurveyCandidates(systems, tick, rng),
    ...selectBountyCandidates(systems, dangerLevels, tick, rng),
  ];
}
