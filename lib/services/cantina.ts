import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import { getMarket } from "./market";
import { getActiveEvents } from "./events";
import { calculatePrice } from "@/lib/engine/pricing";
import {
  generateLocalTips,
  generateNeighborTips,
  combineTips,
  type NeighborMarket,
} from "@/lib/engine/cantina/tips";
import { generateRumors } from "@/lib/engine/cantina/rumors";
import { getGreeting } from "@/lib/engine/cantina/greetings";
import type { MarketEntry } from "@/lib/types/game";
import type { CantinaNpcType } from "@/lib/constants/cantina-npcs";
import { isCantinaNpcType } from "@/lib/types/guards";
import type {
  BartenderData,
  PatronData,
  WagerResult,
  WagerError,
  WagerValidation,
  NpcVisitResult,
} from "@/lib/types/cantina";

// ── Bartender tips ──────────────────────────────────────────────

export async function getBartenderTips(
  playerId: string,
  systemId: string,
): Promise<BartenderData> {
  // Read visit count — visits are recorded via POST /visit, not here
  const visits = await getNpcVisits(playerId, "bartender", systemId);
  const greeting = getGreeting("bartender", visits);

  // Get local market
  const { entries: localEntries } = await getMarket(systemId);
  const localTips = generateLocalTips(localEntries);

  // Get neighbor markets (1-hop connections)
  const connections = await prisma.systemConnection.findMany({
    where: {
      OR: [{ fromSystemId: systemId }, { toSystemId: systemId }],
    },
    select: { fromSystemId: true, toSystemId: true },
  });

  const neighborSystemIds = [
    ...new Set(
      connections.map((c) =>
        c.fromSystemId === systemId ? c.toSystemId : c.fromSystemId,
      ),
    ),
  ].slice(0, 3); // Limit to 3 neighbors for performance

  const neighborMarkets: NeighborMarket[] = [];
  for (const neighborId of neighborSystemIds) {
    try {
      const station = await prisma.station.findUnique({
        where: { systemId: neighborId },
        select: {
          id: true,
          system: { select: { name: true } },
          markets: {
            include: {
              good: {
                select: {
                  id: true,
                  name: true,
                  basePrice: true,
                  priceFloor: true,
                  priceCeiling: true,
                },
              },
            },
          },
        },
      });
      if (station) {
        const entries: MarketEntry[] = station.markets.map((m) => ({
          goodId: m.good.id,
          goodName: m.good.name,
          basePrice: m.good.basePrice,
          currentPrice: calculatePrice(
            m.good.basePrice,
            m.supply,
            m.demand,
            m.good.priceFloor,
            m.good.priceCeiling,
          ),
          supply: m.supply,
          demand: m.demand,
        }));
        neighborMarkets.push({
          systemName: station.system.name,
          entries,
        });
      }
    } catch {
      // Skip neighbors with no station
    }
  }

  const neighborTips = generateNeighborTips(localEntries, neighborMarkets);
  const tips = combineTips(localTips, neighborTips);

  return { greeting, tips, visitCount: visits };
}

// ── Patron rumors ───────────────────────────────────────────────

export async function getPatronRumors(
  playerId: string,
): Promise<PatronData> {
  const events = await getActiveEvents(playerId);
  const rumors = generateRumors(events);

  return { rumors };
}

// ── NPC visits ──────────────────────────────────────────────────

export async function recordNpcVisit(
  playerId: string,
  npcType: CantinaNpcType,
  systemId: string,
): Promise<NpcVisitResult> {
  const result = await prisma.npcVisit.upsert({
    where: {
      playerId_npcType_systemId: { playerId, npcType, systemId },
    },
    create: { playerId, npcType, systemId, visits: 1 },
    update: { visits: { increment: 1 } },
  });

  return { npcType: npcType, visits: result.visits };
}

export async function getNpcVisits(
  playerId: string,
  npcType: CantinaNpcType,
  systemId: string,
): Promise<number> {
  const result = await prisma.npcVisit.findUnique({
    where: {
      playerId_npcType_systemId: { playerId, npcType, systemId },
    },
    select: { visits: true },
  });
  return result?.visits ?? 0;
}

export async function getSystemNpcVisits(
  playerId: string,
  systemId: string,
): Promise<Partial<Record<CantinaNpcType, number>>> {
  const results = await prisma.npcVisit.findMany({
    where: { playerId, systemId },
    select: { npcType: true, visits: true },
  });
  const map: Partial<Record<CantinaNpcType, number>> = {};
  for (const r of results) {
    if (isCantinaNpcType(r.npcType)) {
      map[r.npcType] = r.visits;
    }
  }
  return map;
}

// ── Wager ───────────────────────────────────────────────────────

export async function validateWager(
  playerId: string,
  wager: number,
): Promise<WagerValidation> {
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { credits: true },
  });

  if (!player) {
    return { valid: false, currentBalance: 0, error: "Player not found." };
  }

  if (wager <= 0) {
    return {
      valid: false,
      currentBalance: player.credits,
      error: "Wager must be positive.",
    };
  }

  if (player.credits < wager) {
    return {
      valid: false,
      currentBalance: player.credits,
      error: `Insufficient credits. You have ${Math.floor(player.credits)} CR.`,
    };
  }

  return { valid: true, currentBalance: player.credits, error: null };
}

export async function settleWager(
  playerId: string,
  wager: number,
  outcome: "win" | "loss" | "tie",
): Promise<WagerResult | WagerError> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-read balance inside transaction (TOCTOU guard)
      const player = await tx.player.findUniqueOrThrow({
        where: { id: playerId },
        select: { credits: true },
      });

      if (outcome === "tie") {
        return {
          ok: true as const,
          outcome,
          creditsChange: 0,
          newBalance: player.credits,
        };
      }

      if (outcome === "loss") {
        if (player.credits < wager) {
          throw new ServiceError(
            "Insufficient credits to cover wager.",
            400,
          );
        }
        const updated = await tx.player.update({
          where: { id: playerId },
          data: { credits: { decrement: wager } },
          select: { credits: true },
        });
        return {
          ok: true as const,
          outcome,
          creditsChange: -wager,
          newBalance: updated.credits,
        };
      }

      // Win: player gets the pot (net gain = wager)
      const updated = await tx.player.update({
        where: { id: playerId },
        data: { credits: { increment: wager } },
        select: { credits: true },
      });
      return {
        ok: true as const,
        outcome,
        creditsChange: wager,
        newBalance: updated.credits,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof ServiceError) {
      return { ok: false, error: err.message, status: err.status };
    }
    throw err;
  }
}
