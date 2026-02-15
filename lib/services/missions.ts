import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import { computeAllHopDistances } from "@/lib/engine/pathfinding";
import { calculatePrice } from "@/lib/engine/pricing";
import { validateAccept, validateDelivery } from "@/lib/engine/missions";
import type { TradeMissionInfo } from "@/lib/types/game";
import type {
  SystemMissionsData,
  AcceptMissionResult,
  DeliverMissionResult,
} from "@/lib/types/api";

// ── Shared helpers ──────────────────────────────────────────────

/** Load connections and compute all hop distances. */
async function loadHopDistances(): Promise<Map<string, Map<string, number>>> {
  const connections = await prisma.systemConnection.findMany({
    select: { fromSystemId: true, toSystemId: true, fuelCost: true },
  });
  return computeAllHopDistances(connections);
}

/** Get current tick from game world. */
async function getCurrentTick(): Promise<number> {
  const world = await prisma.gameWorld.findFirst();
  return world?.currentTick ?? 0;
}

type MissionRow = {
  id: string;
  systemId: string;
  destinationId: string;
  goodId: string;
  quantity: number;
  reward: number;
  deadlineTick: number;
  eventId: string | null;
  playerId: string | null;
  acceptedAtTick: number | null;
  system: { name: string };
  destination: { name: string };
  good: { name: string };
};

/** Price lookup: destSystemId → goodId → current unit price. */
type PriceLookup = Map<string, Map<string, number>>;

/** Serialize a DB mission row to the client-facing type. */
function serializeMission(
  row: MissionRow,
  tick: number,
  hopDistances: Map<string, Map<string, number>>,
  priceLookup: PriceLookup,
): TradeMissionInfo {
  const hops = hopDistances.get(row.systemId)?.get(row.destinationId) ?? 0;
  const isImport = row.systemId === row.destinationId;
  const unitPrice = priceLookup.get(row.destinationId)?.get(row.goodId) ?? 0;
  const estimatedGoodsValue = unitPrice * row.quantity;

  return {
    id: row.id,
    systemId: row.systemId,
    systemName: row.system.name,
    destinationId: row.destinationId,
    destinationName: row.destination.name,
    goodId: row.goodId,
    goodName: row.good.name,
    quantity: row.quantity,
    reward: row.reward,
    estimatedGoodsValue,
    deadlineTick: row.deadlineTick,
    ticksRemaining: Math.max(0, row.deadlineTick - tick),
    hops,
    isImport,
    isExport: !isImport,
    eventId: row.eventId,
    playerId: row.playerId,
    acceptedAtTick: row.acceptedAtTick,
  };
}

const missionInclude = {
  system: { select: { name: true } },
  destination: { select: { name: true } },
  good: { select: { name: true } },
} as const;

/** Build a price lookup for all destination systems referenced by missions. */
async function buildPriceLookup(
  missions: Array<{ destinationId: string; goodId: string }>,
): Promise<PriceLookup> {
  const lookup: PriceLookup = new Map();
  if (missions.length === 0) return lookup;

  // Collect unique destination system IDs
  const destIds = [...new Set(missions.map((m) => m.destinationId))];

  // Fetch all market entries at those stations in one query
  const markets = await prisma.stationMarket.findMany({
    where: { station: { systemId: { in: destIds } } },
    include: { good: true, station: { select: { systemId: true } } },
  });

  for (const entry of markets) {
    const systemId = entry.station.systemId;
    let goodMap = lookup.get(systemId);
    if (!goodMap) {
      goodMap = new Map();
      lookup.set(systemId, goodMap);
    }
    const price = calculatePrice(
      entry.good.basePrice,
      entry.supply,
      entry.demand,
      entry.good.priceFloor,
      entry.good.priceCeiling,
    );
    goodMap.set(entry.goodId, price);
  }

  return lookup;
}

// ── Read functions ──────────────────────────────────────────────

export async function getSystemMissions(
  playerId: string,
  systemId: string,
): Promise<SystemMissionsData> {
  const tick = await getCurrentTick();
  const hopDistances = await loadHopDistances();

  const [available, active] = await Promise.all([
    prisma.tradeMission.findMany({
      where: {
        systemId,
        playerId: null,
        deadlineTick: { gt: tick },
      },
      include: missionInclude,
    }),
    prisma.tradeMission.findMany({
      where: { playerId },
      include: missionInclude,
    }),
  ]);

  const allMissions = [...available, ...active];
  const priceLookup = await buildPriceLookup(allMissions);

  return {
    available: available.map((m) => serializeMission(m, tick, hopDistances, priceLookup)),
    active: active.map((m) => serializeMission(m, tick, hopDistances, priceLookup)),
  };
}

export async function getPlayerMissions(
  playerId: string,
): Promise<TradeMissionInfo[]> {
  const tick = await getCurrentTick();
  const hopDistances = await loadHopDistances();

  const missions = await prisma.tradeMission.findMany({
    where: { playerId },
    include: missionInclude,
  });

  const priceLookup = await buildPriceLookup(missions);

  return missions.map((m) => serializeMission(m, tick, hopDistances, priceLookup));
}

// ── Mutation functions ──────────────────────────────────────────

type AcceptResult =
  | { ok: true; data: AcceptMissionResult }
  | { ok: false; error: string; status: number };

export async function acceptMission(
  playerId: string,
  missionId: string,
): Promise<AcceptResult> {
  // Pre-validate: fetch mission and player state
  const mission = await prisma.tradeMission.findUnique({
    where: { id: missionId },
    include: missionInclude,
  });

  if (!mission) {
    return { ok: false, error: "Mission not found.", status: 404 };
  }

  // Get player's docked ship system IDs
  const dockedShips = await prisma.ship.findMany({
    where: { playerId, status: "docked" },
    select: { systemId: true },
  });
  const dockedSystemIds = dockedShips.map((s) => s.systemId);

  // Count active missions
  const activeCount = await prisma.tradeMission.count({
    where: { playerId },
  });

  const validation = validateAccept(
    mission.playerId,
    dockedSystemIds,
    mission.systemId,
    activeCount,
  );

  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  const tick = await getCurrentTick();

  // Transaction: TOCTOU guard — re-read mission inside transaction
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.tradeMission.findUnique({
      where: { id: missionId },
    });

    if (!fresh || fresh.playerId !== null) {
      throw new Error("MISSION_UNAVAILABLE");
    }

    return tx.tradeMission.update({
      where: { id: missionId },
      data: {
        playerId,
        acceptedAtTick: tick,
      },
      include: missionInclude,
    });
  }).catch((error) => {
    if (error instanceof Error && error.message === "MISSION_UNAVAILABLE") {
      return null;
    }
    throw error;
  });

  if (!updated) {
    return { ok: false, error: "Mission is no longer available.", status: 409 };
  }

  const hopDistances = await loadHopDistances();
  const priceLookup = await buildPriceLookup([updated]);
  const newActiveCount = activeCount + 1;

  return {
    ok: true,
    data: {
      mission: serializeMission(updated, tick, hopDistances, priceLookup),
      activeCount: newActiveCount,
    },
  };
}

type DeliverResult =
  | { ok: true; data: DeliverMissionResult }
  | { ok: false; error: string; status: number };

export async function deliverMission(
  playerId: string,
  missionId: string,
  shipId: string,
): Promise<DeliverResult> {
  const mission = await prisma.tradeMission.findUnique({
    where: { id: missionId },
    include: missionInclude,
  });

  if (!mission) {
    return { ok: false, error: "Mission not found.", status: 404 };
  }

  // Fetch ship with cargo
  const ship = await prisma.ship.findUnique({
    where: { id: shipId },
    include: { cargo: { include: { good: true } } },
  });

  if (!ship || ship.playerId !== playerId) {
    return { ok: false, error: "Ship not found or does not belong to you.", status: 404 };
  }

  if (ship.status !== "docked") {
    return { ok: false, error: "Ship must be docked to deliver.", status: 400 };
  }

  // Find the matching cargo item by good ID
  const cargoItem = ship.cargo.find((c) => c.goodId === mission.goodId);
  const cargoQty = cargoItem?.quantity ?? 0;

  const tick = await getCurrentTick();

  const validation = validateDelivery(
    mission.playerId,
    playerId,
    ship.systemId,
    mission.destinationId,
    cargoQty,
    mission.quantity,
    mission.deadlineTick,
    tick,
  );

  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  // Look up the destination station market to calculate sell price
  const station = await prisma.station.findUnique({
    where: { systemId: mission.destinationId },
  });

  if (!station) {
    return { ok: false, error: "Destination station not found.", status: 500 };
  }

  const marketEntry = await prisma.stationMarket.findUnique({
    where: { stationId_goodId: { stationId: station.id, goodId: mission.goodId } },
    include: { good: true },
  });

  if (!marketEntry) {
    return { ok: false, error: "Good not available at destination market.", status: 500 };
  }

  const unitPrice = calculatePrice(
    marketEntry.good.basePrice,
    marketEntry.supply,
    marketEntry.demand,
    marketEntry.good.priceFloor,
    marketEntry.good.priceCeiling,
  );
  const goodsValue = unitPrice * mission.quantity;
  const totalCredit = goodsValue + mission.reward;

  // Demand impact: 10% of traded quantity (matches normal sell trades)
  const demandDelta = -Math.round(mission.quantity * 0.1);

  // Transaction: re-read cargo (TOCTOU), decrement cargo, update market, credit player, delete mission
  const result = await prisma.$transaction(async (tx) => {
    // Re-read cargo
    const freshCargo = cargoItem
      ? await tx.cargoItem.findUnique({ where: { id: cargoItem.id } })
      : null;

    if (!freshCargo || freshCargo.quantity < mission.quantity) {
      throw new Error("INSUFFICIENT_CARGO");
    }

    // Decrement cargo
    const newQty = freshCargo.quantity - mission.quantity;
    if (newQty <= 0) {
      await tx.cargoItem.delete({ where: { id: freshCargo.id } });
    } else {
      await tx.cargoItem.update({
        where: { id: freshCargo.id },
        data: { quantity: newQty },
      });
    }

    // Update market supply/demand (sell adds supply, reduces demand)
    const freshMarket = await tx.stationMarket.findUnique({
      where: { id: marketEntry.id },
    });
    await tx.stationMarket.update({
      where: { id: marketEntry.id },
      data: {
        supply: Math.max(0, (freshMarket?.supply ?? 0) + mission.quantity),
        demand: Math.max(0, (freshMarket?.demand ?? 0) + demandDelta),
      },
    });

    // Credit player: goods sale value + mission reward
    const updatedPlayer = await tx.player.update({
      where: { id: playerId },
      data: { credits: { increment: totalCredit } },
    });

    // Record trade history
    await tx.tradeHistory.create({
      data: {
        stationId: station.id,
        goodId: mission.goodId,
        price: unitPrice,
        quantity: mission.quantity,
        type: "sell",
        playerId,
      },
    });

    // Delete the mission
    await tx.tradeMission.delete({ where: { id: missionId } });

    return { newBalance: updatedPlayer.credits };
  }).catch((error) => {
    if (error instanceof Error && error.message === "INSUFFICIENT_CARGO") {
      return null;
    }
    throw error;
  });

  if (!result) {
    return { ok: false, error: "Insufficient cargo. State may have changed concurrently.", status: 409 };
  }

  const hopDistances = await loadHopDistances();
  const priceLookup = await buildPriceLookup([mission]);

  return {
    ok: true,
    data: {
      mission: serializeMission(mission, tick, hopDistances, priceLookup),
      goodsValue,
      reward: mission.reward,
      creditEarned: totalCredit,
      newBalance: result.newBalance,
    },
  };
}

type AbandonResult =
  | { ok: true; data: { missionId: string } }
  | { ok: false; error: string; status: number };

export async function abandonMission(
  playerId: string,
  missionId: string,
): Promise<AbandonResult> {
  const mission = await prisma.tradeMission.findUnique({
    where: { id: missionId },
  });

  if (!mission) {
    return { ok: false, error: "Mission not found.", status: 404 };
  }

  if (mission.playerId !== playerId) {
    return { ok: false, error: "This mission does not belong to you.", status: 403 };
  }

  // Return mission to the available pool
  await prisma.tradeMission.update({
    where: { id: missionId },
    data: {
      playerId: null,
      acceptedAtTick: null,
    },
  });

  return { ok: true, data: { missionId } };
}
