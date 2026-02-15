/**
 * Pure mission engine — generation, reward calculation, validation.
 * Zero DB dependency, testable with Vitest.
 */

import { MISSION_CONSTANTS } from "@/lib/constants/missions";

// ── Types ───────────────────────────────────────────────────────

export interface MarketSnapshot {
  systemId: string;
  goodId: string;
  currentPrice: number;
  basePrice: number;
}

export interface MissionCandidate {
  systemId: string;
  destinationId: string;
  goodId: string;
  quantity: number;
  reward: number;
  deadlineTick: number;
  eventId: string | null;
}

export interface EventSnapshot {
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

// ── Economy-based candidate generation ──────────────────────────

/**
 * Generate mission candidates from market conditions.
 * High-price markets → import missions (dest = that system).
 * Low-price markets → export missions (source = that system, dest = random neighbor).
 */
export function selectEconomyCandidates(
  markets: MarketSnapshot[],
  hopDistances: Map<string, Map<string, number>>,
  goodTiers: Record<string, number>,
  tick: number,
  rng: () => number,
): MissionCandidate[] {
  const {
    HIGH_PRICE_THRESHOLD,
    LOW_PRICE_THRESHOLD,
    ECONOMY_GEN_PROBABILITY,
    DEADLINE_TICKS,
    QUANTITY_RANGE,
    MAX_EXPORT_DISTANCE,
  } = MISSION_CONSTANTS;

  const candidates: MissionCandidate[] = [];

  for (const market of markets) {
    const ratio = market.currentPrice / market.basePrice;

    if (ratio > HIGH_PRICE_THRESHOLD) {
      // Import mission: "We need X, bring it here"
      if (rng() > ECONOMY_GEN_PROBABILITY) continue;

      const quantity = QUANTITY_RANGE[0] + Math.floor(rng() * (QUANTITY_RANGE[1] - QUANTITY_RANGE[0] + 1));
      const tier = goodTiers[market.goodId] ?? 0;
      // Import: destination is the same system, hops=0 for self-delivery reward base
      // But we need a hops estimate for reward — use 1 as minimum since player must come from elsewhere
      const reward = calculateReward(quantity, 1, tier, false);

      candidates.push({
        systemId: market.systemId,
        destinationId: market.systemId,
        goodId: market.goodId,
        quantity,
        reward,
        deadlineTick: tick + DEADLINE_TICKS,
        eventId: null,
      });
    } else if (ratio < LOW_PRICE_THRESHOLD) {
      // Export mission: "We have surplus X, deliver to Y"
      if (rng() > ECONOMY_GEN_PROBABILITY) continue;

      const distances = hopDistances.get(market.systemId);
      if (!distances) continue;

      // Pick a random destination 1-MAX_EXPORT_DISTANCE hops away
      const eligible = [...distances.entries()].filter(
        ([id, hops]) => id !== market.systemId && hops >= 1 && hops <= MAX_EXPORT_DISTANCE,
      );
      if (eligible.length === 0) continue;

      const [destId, hops] = eligible[Math.floor(rng() * eligible.length)];
      const quantity = QUANTITY_RANGE[0] + Math.floor(rng() * (QUANTITY_RANGE[1] - QUANTITY_RANGE[0] + 1));
      const tier = goodTiers[market.goodId] ?? 0;
      const reward = calculateReward(quantity, hops, tier, false);

      candidates.push({
        systemId: market.systemId,
        destinationId: destId,
        goodId: market.goodId,
        quantity,
        reward,
        deadlineTick: tick + DEADLINE_TICKS,
        eventId: null,
      });
    }
  }

  return candidates;
}

// ── Event-based candidate generation ────────────────────────────

/**
 * Generate mission candidates from active events.
 * Uses EVENT_MISSION_GOODS mapping to determine themed goods.
 */
export function selectEventCandidates(
  events: EventSnapshot[],
  missionGoods: Record<string, EventMissionGoodsEntry>,
  hopDistances: Map<string, Map<string, number>>,
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
 * - Player must have a ship docked at the mission's board station
 * - Player must be under the active mission cap
 */
export function validateAccept(
  missionPlayerId: string | null,
  playerDockedSystemIds: string[],
  missionSystemId: string,
  activeCount: number,
): AcceptValidation {
  if (missionPlayerId !== null) {
    return { ok: false, error: "Mission already accepted." };
  }

  if (!playerDockedSystemIds.includes(missionSystemId)) {
    return { ok: false, error: "You must have a ship docked at this station to accept the mission." };
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
