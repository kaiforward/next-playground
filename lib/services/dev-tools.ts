/**
 * Dev tools service — server-side manipulation of game state.
 * Only usable in development mode.
 */

import { prisma } from "@/lib/prisma";
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { runWorldTick } from "@/lib/world/tick";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { getInitialStock } from "@/lib/constants/market-economy";
import { GOODS } from "@/lib/constants/goods";
import { buildModifiersForPhase, rollPhaseDuration } from "@/lib/engine/events";
import { spotPrice, curveForGood } from "@/lib/engine/market-pricing";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import { isEventTypeId } from "@/lib/types/guards";

// ── Result types ────────────────────────────────────────────────

type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Advance ticks ───────────────────────────────────────────────

export async function advanceTicks(count: number): Promise<ServiceResult<{ newTick: number; elapsed: number }>> {
  if (count < 1 || count > 1000) {
    return { ok: false, error: "Count must be between 1 and 1000." };
  }
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded." };
  }

  const start = performance.now();

  let world = getWorld();
  for (let i = 0; i < count; i++) {
    const result = await runWorldTick(world);
    world = result.world;
  }
  setWorld(world);

  return {
    ok: true,
    data: {
      newTick: world.meta.currentTick,
      elapsed: Math.round(performance.now() - start),
    },
  };
}

// ── Spawn event ─────────────────────────────────────────────────

export async function spawnEvent(params: {
  systemId: string;
  eventType: string;
  severity?: number;
}): Promise<ServiceResult<{ eventId: string; type: string; phase: string }>> {
  if (!isEventTypeId(params.eventType)) {
    return { ok: false, error: `Unknown event type: ${params.eventType}` };
  }
  const def = EVENT_DEFINITIONS[params.eventType];

  const system = await prisma.starSystem.findUnique({
    where: { id: params.systemId },
    select: { id: true, regionId: true },
  });
  if (!system) {
    return { ok: false, error: `System not found: ${params.systemId}` };
  }

  const severity = params.severity ?? 1.0;
  const firstPhase = def.phases[0];
  const duration = rollPhaseDuration(firstPhase.durationRange, Math.random);

  const world = await prisma.gameWorld.findUnique({ where: { id: "world" } });
  const tick = world?.currentTick ?? 0;

  const event = await prisma.$transaction(async (tx) => {
    const newEvent = await tx.gameEvent.create({
      data: {
        type: params.eventType,
        phase: firstPhase.name,
        systemId: system.id,
        regionId: system.regionId,
        startTick: tick,
        phaseStartTick: tick,
        phaseDuration: duration,
        severity,
      },
    });

    const modifierRows = buildModifiersForPhase(
      firstPhase,
      system.id,
      system.regionId,
      severity,
    );

    if (modifierRows.length > 0) {
      await tx.eventModifier.createMany({
        data: modifierRows.map((row) => ({ eventId: newEvent.id, ...row })),
      });
    }

    return newEvent;
  });

  return {
    ok: true,
    data: { eventId: event.id, type: event.type, phase: event.phase },
  };
}

// ── Give credits ────────────────────────────────────────────────

export async function giveCredits(
  playerId: string,
  amount: number,
): Promise<ServiceResult<{ credits: number }>> {
  if (amount === 0) {
    return { ok: false, error: "Amount must not be zero." };
  }

  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) {
    return { ok: false, error: `Player not found: ${playerId}` };
  }

  const updated = await prisma.player.update({
    where: { id: playerId },
    data: { credits: { increment: amount } },
  });

  return { ok: true, data: { credits: updated.credits } };
}

// ── Teleport ship ───────────────────────────────────────────────

export async function teleportShip(
  shipId: string,
  systemId: string,
): Promise<ServiceResult<{ shipId: string; systemId: string }>> {
  const ship = await prisma.ship.findUnique({ where: { id: shipId } });
  if (!ship) {
    return { ok: false, error: `Ship not found: ${shipId}` };
  }

  const system = await prisma.starSystem.findUnique({ where: { id: systemId } });
  if (!system) {
    return { ok: false, error: `System not found: ${systemId}` };
  }

  await prisma.ship.update({
    where: { id: shipId },
    data: {
      systemId,
      status: "docked",
      destinationSystemId: null,
      departureTick: null,
      arrivalTick: null,
    },
  });

  return { ok: true, data: { shipId, systemId } };
}

// ── Economy snapshot ────────────────────────────────────────────

export interface EconomySnapshotSystem {
  systemId: string;
  systemName: string;
  economyType: string;
  markets: {
    goodId: string;
    goodName: string;
    stock: number;
    price: number;
  }[];
}

export async function getEconomySnapshot(): Promise<ServiceResult<{ systems: EconomySnapshotSystem[] }>> {
  const systems = await prisma.starSystem.findMany({
    include: {
      station: {
        include: {
          markets: { include: { good: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const result: EconomySnapshotSystem[] = systems.map((sys) => ({
    systemId: sys.id,
    systemName: sys.name,
    economyType: sys.economyType,
    markets: (sys.station?.markets ?? []).map((m) => {
      return {
        goodId: m.goodId,
        goodName: m.good.name,
        stock: m.stock,
        price: spotPrice(curveForGood(m.good.basePrice, m.good.priceFloor, m.good.priceCeiling, m.demandRate, m.anchorMult), m.stock),
      };
    }),
  }));

  return { ok: true, data: { systems: result } };
}

// ── Reset economy ───────────────────────────────────────────────

export async function resetEconomy(): Promise<ServiceResult<{ marketsReset: number; eventsCleared: number }>> {
  const result = await prisma.$transaction(async (tx) => {
    // Count events before clearing
    const eventCount = await tx.gameEvent.count();

    // Delete all events (modifiers cascade)
    await tx.gameEvent.deleteMany();

    // Reset all markets to equilibrium
    const markets = await tx.stationMarket.findMany({
      include: {
        good: true,
        station: { include: { system: true } },
      },
    });

    const goodKeyByName = new Map(
      Object.entries(GOODS).map(([key, def]) => [def.name, key]),
    );

    // Bulk-load the industrial base once and group by system. Seed stock is now
    // capacity-driven (built extractors × per-resource yield), so each market's
    // net balance needs its system's buildings — a per-row query would blow the
    // tx timeout at scale.
    const buildingRows = await tx.systemBuilding.findMany({
      select: { systemId: true, buildingType: true, count: true },
    });
    const buildingsBySystem = new Map<string, Record<string, number>>();
    for (const row of buildingRows) {
      const bag = buildingsBySystem.get(row.systemId) ?? {};
      bag[row.buildingType] = row.count;
      buildingsBySystem.set(row.systemId, bag);
    }

    // Collect (id, stock) pairs and bulk-write with a single unnest() UPDATE.
    // A per-row update loop blows the 30s tx timeout at 10K scale (~60–120K
    // rows). Mirrors PrismaEconomyWorld.applyMarketUpdates.
    const ids: string[] = [];
    const stocks: number[] = [];
    for (const m of markets) {
      const sys = m.station.system;
      const buildings = buildingsBySystem.get(sys.id) ?? {};
      const yields = resourceVectorFromColumns(
        {
          yieldGas: sys.yieldGas, yieldMinerals: sys.yieldMinerals, yieldOre: sys.yieldOre,
          yieldBiomass: sys.yieldBiomass, yieldArable: sys.yieldArable,
          yieldWater: sys.yieldWater, yieldRadioactive: sys.yieldRadioactive,
        },
        "yield",
      );
      const goodKey = goodKeyByName.get(m.good.name) ?? m.good.name;
      ids.push(m.id);
      stocks.push(getInitialStock(buildings, yields, sys.population, goodKey));
    }

    if (ids.length > 0) {
      // anchorMult resets to 1 alongside stock: all events (and their
      // anchor_shift modifiers) were just deleted, so the neutral anchor is the
      // correct clean-slate value. Without this, a stale non-1 anchorMult would
      // skew read-path prices until the economy shard processor next
      // processes each market's system.
      await tx.$executeRaw`
        UPDATE "StationMarket" AS sm
        SET "stock" = batch."stock", "anchorMult" = 1
        FROM unnest(${ids}::text[], ${stocks}::double precision[])
          AS batch("id", "stock")
        WHERE sm."id" = batch."id"`;
    }

    return { marketsReset: ids.length, eventsCleared: eventCount };
  });

  return { ok: true, data: result };
}
