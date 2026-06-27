/**
 * Pure mission engine — generation, reward calculation, validation.
 * Zero DB dependency, testable with Vitest.
 */

import { MISSION_CONSTANTS } from "@/lib/constants/missions";

// ── Types ───────────────────────────────────────────────────────

export interface MissionCandidate {
  systemId: string;
  destinationId: string;
  goodId: string;
  quantity: number;
  reward: number;
  deadlineTick: number;
  eventId: string | null;
}

/** Minimal event snapshot for mission generation (system-level events only). */
export interface MissionEventSnapshot {
  id: string;
  type: string;
  systemId: string;
}

export interface EventMissionGoodsEntry {
  goods: string[];
  isImport: boolean;
}

// ── Reward calculation ──────────────────────────────────────────

/**
 * Calculate mission reward.
 * REWARD_PER_UNIT * quantity * DISTANCE_MULT^hops * TIER_MULT * EVENT_MULT, floor at REWARD_MIN.
 */
export function calculateReward(
  quantity: number,
  hops: number,
  goodTier: number,
  isEventLinked: boolean,
): number {
  const {
    REWARD_PER_UNIT,
    REWARD_DISTANCE_MULT,
    REWARD_TIER_MULT,
    REWARD_EVENT_MULT,
    REWARD_MIN,
  } = MISSION_CONSTANTS;

  const tierMult = REWARD_TIER_MULT[goodTier] ?? 1.0;
  const distMult = Math.pow(REWARD_DISTANCE_MULT, hops);
  const eventMult = isEventLinked ? REWARD_EVENT_MULT : 1.0;

  const raw = REWARD_PER_UNIT * quantity * distMult * tierMult * eventMult;
  return Math.max(REWARD_MIN, Math.floor(raw));
}

// ── Event-based candidate generation ────────────────────────────

/**
 * Generate mission candidates from active events.
 * Uses EVENT_MISSION_GOODS mapping to determine themed goods.
 */
export function selectEventCandidates(
  events: MissionEventSnapshot[],
  missionGoods: Partial<Record<string, EventMissionGoodsEntry>>,
  goodTiers: Record<string, number>,
  tick: number,
  rng: () => number,
): MissionCandidate[] {
  const { DEADLINE_TICKS, QUANTITY_RANGE } = MISSION_CONSTANTS;
  const candidates: MissionCandidate[] = [];

  for (const event of events) {
    const theme = missionGoods[event.type];
    if (!theme) continue;

    // Generate 1-3 missions per event
    const count = 1 + Math.floor(rng() * 3);
    const goodsPool = theme.goods;

    for (let i = 0; i < count && i < goodsPool.length; i++) {
      const goodId = goodsPool[i];
      const quantity = QUANTITY_RANGE[0] + Math.floor(rng() * (QUANTITY_RANGE[1] - QUANTITY_RANGE[0] + 1));
      const tier = goodTiers[goodId] ?? 0;

      // Import missions: posted at the event system, delivery there too
      const systemId = event.systemId;
      const destinationId = event.systemId;
      const reward = calculateReward(quantity, 1, tier, true);

      candidates.push({
        systemId,
        destinationId,
        goodId,
        quantity,
        reward,
        deadlineTick: tick + DEADLINE_TICKS,
        eventId: event.id,
      });
    }
  }

  return candidates;
}

// ── Validation ──────────────────────────────────────────────────

export type AcceptValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate that a player can accept a mission.
 * - Mission must not already be accepted
 * - Player must be under the active mission cap
 */
export function validateAccept(
  missionPlayerId: string | null,
  activeCount: number,
): AcceptValidation {
  if (missionPlayerId !== null) {
    return { ok: false, error: "Mission already accepted." };
  }

  if (activeCount >= MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER) {
    return { ok: false, error: `Cannot have more than ${MISSION_CONSTANTS.MAX_ACTIVE_PER_PLAYER} active missions.` };
  }

  return { ok: true };
}

export type DeliveryValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate that a player can deliver a mission.
 * - Mission must belong to the player
 * - Ship must be docked at the destination
 * - Ship must have enough cargo
 * - Mission must not be past deadline
 */
export function validateDelivery(
  missionPlayerId: string | null,
  playerId: string,
  shipSystemId: string,
  missionDestinationId: string,
  shipCargoQty: number,
  missionQuantity: number,
  deadlineTick: number,
  currentTick: number,
): DeliveryValidation {
  if (missionPlayerId !== playerId) {
    return { ok: false, error: "This mission does not belong to you." };
  }

  if (shipSystemId !== missionDestinationId) {
    return { ok: false, error: "Ship must be docked at the mission destination." };
  }

  if (shipCargoQty < missionQuantity) {
    return { ok: false, error: `Insufficient cargo. Need ${missionQuantity}, have ${shipCargoQty}.` };
  }

  if (currentTick > deadlineTick) {
    return { ok: false, error: "Mission has expired." };
  }

  return { ok: true };
}
