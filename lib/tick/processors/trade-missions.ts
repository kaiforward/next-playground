import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  PlayerEventMap,
} from "../types";
import { addPlayerNotification } from "../helpers";
import {
  selectEconomyCandidates,
  selectEventCandidates,
} from "@/lib/engine/missions";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";
import { EVENT_MISSION_GOODS } from "@/lib/constants/events";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { loadHopDistances } from "@/lib/services/hop-distances";
import { shardRange } from "@/lib/tick/shard";
import { MISSION_GEN_INTERVAL } from "@/lib/constants/tick-cadence";
import { PrismaTradeMissionsWorld } from "@/lib/tick/adapters/prisma/trade-missions";
import type {
  MissionCreate,
  TradeMissionsWorld,
} from "@/lib/tick/world/trade-missions-world";

export interface TradeMissionsProcessorParams {
  rng: () => number;
  interval: number;
}

/**
 * Pure processor body. Depends only on `TradeMissionsWorld` + an injected
 * RNG. No live sim counterpart yet; the abstraction is in place so adding
 * one (or unit-testing without Prisma) is straightforward.
 */
export async function runTradeMissionsProcessor(
  world: TradeMissionsWorld,
  ctx: TickContext,
  params: TradeMissionsProcessorParams,
): Promise<TickProcessorResult> {
  const { rng, interval } = params;

  // 1. Expire missions ────────────────────────────────────────────
  const expiredUnclaimedCount = await world.expireUnclaimedMissions(ctx.tick);
  const expiredAccepted = await world.getExpiredAcceptedMissions(ctx.tick);

  const playerEvents = new Map<string, Partial<PlayerEventMap>>();

  if (expiredAccepted.length > 0) {
    await world.deleteMissions(expiredAccepted.map((m) => m.id));
    for (const m of expiredAccepted) {
      addPlayerNotification(playerEvents, m.playerId, {
        message: `Mission expired: deliver ${m.quantity} ${m.goodName} to ${m.destinationName}`,
        type: "mission_expired",
        refs: {
          system: { id: m.destinationId, label: m.destinationName },
        },
      });
    }
  }

  // 2. Candidate selection (engine) ───────────────────────────────
  const hopDistances = await loadHopDistances();

  // Economy/price generation — sharded over the long interval so every system
  // is scanned once per `interval` ticks without a single global sweep.
  const allSystemIds = await world.getSystemIds();
  const { start, end } = shardRange(allSystemIds.length, ctx.tick, interval);
  const sliceIds = allSystemIds.slice(start, end);
  const marketSnapshots = await world.getMarketPricesForSystems(sliceIds);
  const economyCandidates = selectEconomyCandidates(
    marketSnapshots,
    hopDistances,
    GOOD_TIER_BY_KEY,
    ctx.tick,
    rng,
  );

  // Event generation — responsive (every tick, all active events). Events are
  // mostly shorter than the 120-tick cycle; event-themed missions must appear
  // during their event regardless of which economy slice is active.
  const activeEvents = await world.getActiveEvents();
  const eventCandidates = selectEventCandidates(
    activeEvents,
    EVENT_MISSION_GOODS,
    GOOD_TIER_BY_KEY,
    ctx.tick,
    rng,
  );

  const allCandidates = [...economyCandidates, ...eventCandidates];

  const shardIndex = ((ctx.tick % interval) + interval) % interval;
  if (allCandidates.length === 0) {
    if (expiredUnclaimedCount > 0 || expiredAccepted.length > 0) {
      console.log(
        `[trade-missions] Shard ${shardIndex + 1}/${interval} — expired ${expiredUnclaimedCount} unclaimed + ${expiredAccepted.length} accepted, generated 0`,
      );
    }
    await world.persistNotifications(playerEvents, ctx.tick);
    return {
      globalEvents: {
        missionsUpdated: [{ count: 0, expired: expiredUnclaimedCount }],
      },
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  }

  // 3. Per-station cap + good ID resolution ───────────────────────
  const countByStation = await world.getAvailableMissionCountsByStation();
  const goodKeyToId = await world.resolveGoodIds();

  const toCreate: MissionCreate[] = [];
  const stationAdds = new Map<string, number>();

  for (const c of allCandidates) {
    const baseCount = countByStation.get(c.systemId) ?? 0;
    const pending = stationAdds.get(c.systemId) ?? 0;
    if (baseCount + pending >= MISSION_CONSTANTS.MAX_AVAILABLE_PER_STATION) {
      continue;
    }

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

  console.log(
    `[trade-missions] Shard ${shardIndex + 1}/${interval} — expired ${expiredUnclaimedCount} unclaimed + ${expiredAccepted.length} accepted, generated ${toCreate.length}` +
      ` (${economyCandidates.length} economy, ${eventCandidates.length} event candidates)`,
  );

  await world.persistNotifications(playerEvents, ctx.tick);

  return {
    globalEvents: {
      missionsUpdated: [
        { count: toCreate.length, expired: expiredUnclaimedCount },
      ],
    },
    playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
  };
}

// ── Live-game wiring ──────────────────────────────────────────────

export const tradeMissionsProcessor: TickProcessor = {
  name: "trade-missions",
  // Runs every tick; economy shard and responsive event path handled inside body.
  frequency: 1,
  dependsOn: ["events", "economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaTradeMissionsWorld(ctx.tx);
    return runTradeMissionsProcessor(world, ctx, {
      rng: Math.random,
      interval: MISSION_GEN_INTERVAL,
    });
  },
};
