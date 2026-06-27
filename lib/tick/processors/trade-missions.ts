import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  PlayerEventMap,
} from "../types";
import { addPlayerNotification } from "../helpers";
import { selectEventCandidates } from "@/lib/engine/missions";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";
import { EVENT_MISSION_GOODS } from "@/lib/constants/events";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { PrismaTradeMissionsWorld } from "@/lib/tick/adapters/prisma/trade-missions";
import type {
  MissionCreate,
  TradeMissionsWorld,
} from "@/lib/tick/world/trade-missions-world";

export interface TradeMissionsProcessorParams {
  rng: () => number;
}

/**
 * Pure processor body. Trade missions are now generated only from active events (the demand-driven
 * supply hauls live in the directed-logistics processor as logistics Contracts). This processor owns
 * the generic player lifecycle: expiring missions + event-themed generation. Logistics Contracts are
 * excluded from unclaimed expiry — directed-logistics resolves (hauls) those itself.
 */
export async function runTradeMissionsProcessor(
  world: TradeMissionsWorld,
  ctx: TickContext,
  params: TradeMissionsProcessorParams,
): Promise<TickProcessorResult> {
  const { rng } = params;

  // 1. Expire missions.
  const expiredUnclaimedCount = await world.expireUnclaimedMissions(ctx.tick);
  const expiredAccepted = await world.getExpiredAcceptedMissions(ctx.tick);

  const playerEvents = new Map<string, Partial<PlayerEventMap>>();
  if (expiredAccepted.length > 0) {
    await world.deleteMissions(expiredAccepted.map((m) => m.id));
    for (const m of expiredAccepted) {
      addPlayerNotification(playerEvents, m.playerId, {
        message: `Mission expired: deliver ${m.quantity} ${m.goodName} to ${m.destinationName}`,
        type: "mission_expired",
        refs: { system: { id: m.destinationId, label: m.destinationName } },
      });
    }
  }

  // 2. Event-themed generation (responsive, every tick).
  const activeEvents = await world.getActiveEvents();
  const candidates = selectEventCandidates(
    activeEvents,
    EVENT_MISSION_GOODS,
    GOOD_TIER_BY_KEY,
    ctx.tick,
    rng,
  );

  if (candidates.length === 0) {
    await world.persistNotifications(playerEvents, ctx.tick);
    return {
      globalEvents: { missionsUpdated: [{ count: 0, expired: expiredUnclaimedCount }] },
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  }

  // 3. Per-station cap + good ID resolution.
  const countByStation = await world.getAvailableMissionCountsByStation();
  const goodKeyToId = await world.resolveGoodIds();

  const toCreate: MissionCreate[] = [];
  const stationAdds = new Map<string, number>();
  for (const c of candidates) {
    const baseCount = countByStation.get(c.systemId) ?? 0;
    const pending = stationAdds.get(c.systemId) ?? 0;
    if (baseCount + pending >= MISSION_CONSTANTS.MAX_AVAILABLE_PER_STATION) continue;

    const dbGoodId = goodKeyToId.get(c.goodId);
    if (!dbGoodId) continue;

    toCreate.push({
      systemId: c.systemId,
      destinationId: c.destinationId,
      goodId: dbGoodId,
      quantity: c.quantity,
      reward: c.reward,
      deadlineTick: c.deadlineTick,
      eventId: c.eventId,
      createdAtTick: ctx.tick,
    });
    stationAdds.set(c.systemId, pending + 1);
  }

  await world.createMissions(toCreate);
  await world.persistNotifications(playerEvents, ctx.tick);

  return {
    globalEvents: { missionsUpdated: [{ count: toCreate.length, expired: expiredUnclaimedCount }] },
    playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
  };
}

// ── Live-game wiring ──────────────────────────────────────────────

export const tradeMissionsProcessor: TickProcessor = {
  name: "trade-missions",
  frequency: 1,
  dependsOn: ["events", "economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaTradeMissionsWorld(ctx.tx);
    return runTradeMissionsProcessor(world, ctx, { rng: Math.random });
  },
};
