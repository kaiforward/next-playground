import type {
  TickProcessor,
  TickProcessorResult,
  GameNotificationPayload,
  PlayerEventMap,
} from "../types";
import { persistPlayerNotifications } from "../helpers";
import { computeAllHopDistances } from "@/lib/engine/pathfinding";
import {
  selectEconomyCandidates,
  selectEventCandidates,
  type MarketSnapshot,
} from "@/lib/engine/missions";
import { calculatePrice } from "@/lib/engine/pricing";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";
import { EVENT_MISSION_GOODS } from "@/lib/constants/events";
import { GOODS } from "@/lib/constants/goods";

/** Build good tier lookup from GOODS constants. */
const goodTiers: Record<string, number> = Object.fromEntries(
  Object.entries(GOODS).map(([key, def]) => [key, def.tier]),
);

/** Reverse lookup: Good.name → key (e.g. "Food" → "food"). */
const goodNameToKey = new Map(
  Object.entries(GOODS).map(([key, def]) => [def.name, key]),
);

export const tradeMissionsProcessor: TickProcessor = {
  name: "trade-missions",
  frequency: 5,
  dependsOn: ["events", "economy"],

  async process(ctx): Promise<TickProcessorResult> {
    // 1a. Expire unclaimed missions past deadline
    const expired = await ctx.tx.tradeMission.deleteMany({
      where: {
        deadlineTick: { lte: ctx.tick },
        playerId: null,
      },
    });

    // 1b. Expire accepted missions past deadline — notify players
    const expiredAccepted = await ctx.tx.tradeMission.findMany({
      where: {
        deadlineTick: { lte: ctx.tick },
        playerId: { not: null },
      },
      select: {
        id: true,
        playerId: true,
        quantity: true,
        good: { select: { name: true } },
        destination: { select: { name: true } },
      },
    });

    const playerEvents = new Map<string, Partial<PlayerEventMap>>();

    if (expiredAccepted.length > 0) {
      await ctx.tx.tradeMission.deleteMany({
        where: { id: { in: expiredAccepted.map((m) => m.id) } },
      });

      for (const m of expiredAccepted) {
        const playerId = m.playerId!;
        const existing = playerEvents.get(playerId) ?? {};
        const notification: GameNotificationPayload = {
          message: `Mission expired: deliver ${m.quantity} ${m.good.name} to ${m.destination.name}`,
          type: "mission_expired",
          refs: {},
        };
        existing.gameNotifications = existing.gameNotifications
          ? [...existing.gameNotifications, notification]
          : [notification];
        playerEvents.set(playerId, existing);
      }
    }

    // 2. Fetch connections and compute hop distances
    const connections = await ctx.tx.systemConnection.findMany({
      select: { fromSystemId: true, toSystemId: true, fuelCost: true },
    });
    const hopDistances = computeAllHopDistances(connections);

    // 3. Fetch all markets with good data for price snapshots
    const markets = await ctx.tx.stationMarket.findMany({
      include: {
        good: true,
        station: { select: { systemId: true } },
      },
    });

    const marketSnapshots: MarketSnapshot[] = markets.map((m) => {
      const price = calculatePrice(
        m.good.basePrice,
        m.supply,
        m.demand,
        m.good.priceFloor,
        m.good.priceCeiling,
      );
      const goodKey = goodNameToKey.get(m.good.name) ?? m.good.id;
      return {
        systemId: m.station.systemId,
        goodId: goodKey,
        currentPrice: price,
        basePrice: m.good.basePrice,
      };
    });

    // 4. Economy-based candidates
    const economyCandidates = selectEconomyCandidates(
      marketSnapshots,
      hopDistances,
      goodTiers,
      ctx.tick,
      Math.random,
    );

    // 5. Event-based candidates
    const activeEvents = await ctx.tx.gameEvent.findMany({
      where: { systemId: { not: null } },
      select: { id: true, type: true, systemId: true },
    });

    const eventSnapshots = activeEvents
      .filter((e): e is typeof e & { systemId: string } => e.systemId !== null);

    const eventCandidates = selectEventCandidates(
      eventSnapshots,
      EVENT_MISSION_GOODS,
      hopDistances,
      goodTiers,
      ctx.tick,
      Math.random,
    );

    // 6. Cap check per station — count existing available missions
    const allCandidates = [...economyCandidates, ...eventCandidates];

    if (allCandidates.length === 0) {
      if (expired.count > 0 || expiredAccepted.length > 0) {
        console.log(`[trade-missions] Expired ${expired.count} unclaimed + ${expiredAccepted.length} accepted mission(s), generated 0`);
      }
      return {
        globalEvents: { missionsUpdated: [{ count: 0, expired: expired.count }] },
        playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
      };
    }

    // Count existing available missions per station
    const existingCounts = await ctx.tx.tradeMission.groupBy({
      by: ["systemId"],
      where: { playerId: null },
      _count: { id: true },
    });

    const countByStation = new Map(
      existingCounts.map((r) => [r.systemId, r._count.id]),
    );

    // Resolve good keys to DB good IDs
    const goodRecords = await ctx.tx.good.findMany({
      select: { id: true, name: true },
    });
    const goodKeyToId = new Map<string, string>();
    for (const g of goodRecords) {
      const key = goodNameToKey.get(g.name);
      if (key) goodKeyToId.set(key, g.id);
      // Also map by lowercase name in case key matches
      goodKeyToId.set(g.name.toLowerCase(), g.id);
    }

    // Filter by station cap and resolve good IDs
    const toCreate: Array<{
      systemId: string;
      destinationId: string;
      goodId: string;
      quantity: number;
      reward: number;
      deadlineTick: number;
      eventId: string | null;
      createdAtTick: number;
    }> = [];

    for (const c of allCandidates) {
      const currentCount = countByStation.get(c.systemId) ?? 0;
      if (currentCount + toCreate.filter((t) => t.systemId === c.systemId).length
          >= MISSION_CONSTANTS.MAX_AVAILABLE_PER_STATION) {
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
    }

    // 7. Batch create
    if (toCreate.length > 0) {
      await ctx.tx.tradeMission.createMany({ data: toCreate });
    }

    console.log(
      `[trade-missions] Expired ${expired.count} unclaimed + ${expiredAccepted.length} accepted, generated ${toCreate.length} mission(s)` +
      ` (${economyCandidates.length} economy, ${eventCandidates.length} event candidates)`,
    );

    // Persist notifications to DB
    await persistPlayerNotifications(ctx.tx, playerEvents, ctx.tick);

    return {
      globalEvents: {
        missionsUpdated: [{ count: toCreate.length, expired: expired.count }],
      },
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  },
};
