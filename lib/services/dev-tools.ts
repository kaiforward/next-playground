/**
 * Dev tools service — server-side manipulation of game state.
 * Only usable in development mode. All functions use Prisma.
 */

import { prisma } from "@/lib/prisma";
import { processors, sortProcessors } from "@/lib/tick/registry";
import type { TickContext, TickProcessorResult } from "@/lib/tick/types";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { EQUILIBRIUM_TARGETS } from "@/lib/constants/economy";
import { getProducedGoods, getConsumedGoods } from "@/lib/constants/universe";
import { GOODS } from "@/lib/constants/goods";
import { buildModifiersForPhase, rollPhaseDuration } from "@/lib/engine/events";
import { calculatePrice } from "@/lib/engine/pricing";
import type { EconomyType } from "@/lib/types/game";

// ── Result types ────────────────────────────────────────────────

type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// ── Advance ticks ───────────────────────────────────────────────

export async function advanceTicks(count: number): Promise<ServiceResult<{ newTick: number; elapsed: number }>> {
  if (count < 1 || count > 1000) {
    return { ok: false, error: "Count must be between 1 and 1000." };
  }

  const start = performance.now();

  for (let i = 0; i < count; i++) {
    await prisma.$transaction(async (tx) => {
      const world = await tx.gameWorld.findUnique({ where: { id: "world" } });
      if (!world) return;

      const newTick = world.currentTick + 1;
      await tx.gameWorld.update({
        where: { id: "world" },
        data: { currentTick: newTick, lastTickAt: new Date() },
      });

      const activeProcessors = sortProcessors(processors, newTick);
      const ctx: TickContext = { tx, tick: newTick, results: new Map() };

      for (const processor of activeProcessors) {
        try {
          const result = await processor.process(ctx);
          ctx.results.set(processor.name, result);
        } catch (error) {
          console.error(`[dev-tools] Processor "${processor.name}" failed on tick ${newTick}:`, error);
        }
      }
    });
  }

  const world = await prisma.gameWorld.findUnique({ where: { id: "world" } });
  return {
    ok: true,
    data: {
      newTick: world?.currentTick ?? 0,
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
  const def = EVENT_DEFINITIONS[params.eventType];
  if (!def) {
    return { ok: false, error: `Unknown event type: ${params.eventType}` };
  }

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

// ── Set cargo ───────────────────────────────────────────────────

export async function setShipCargo(
  shipId: string,
  cargo: { goodId: string; quantity: number }[],
): Promise<ServiceResult<{ shipId: string; cargoCount: number }>> {
  const ship = await prisma.ship.findUnique({ where: { id: shipId } });
  if (!ship) {
    return { ok: false, error: `Ship not found: ${shipId}` };
  }

  // Resolve good names to IDs
  const goods = await prisma.good.findMany();
  const goodByName = new Map(goods.map((g) => [g.name.toLowerCase(), g.id]));
  const goodById = new Set(goods.map((g) => g.id));

  await prisma.$transaction(async (tx) => {
    // Clear existing cargo
    await tx.cargoItem.deleteMany({ where: { shipId } });

    // Create new cargo entries
    for (const item of cargo) {
      // Accept either good ID or good key name
      let resolvedGoodId = item.goodId;
      if (!goodById.has(resolvedGoodId)) {
        const byName = goodByName.get(resolvedGoodId.toLowerCase());
        if (byName) resolvedGoodId = byName;
      }

      if (item.quantity > 0) {
        await tx.cargoItem.create({
          data: { shipId, goodId: resolvedGoodId, quantity: item.quantity },
        });
      }
    }
  });

  return { ok: true, data: { shipId, cargoCount: cargo.length } };
}

// ── Economy snapshot ────────────────────────────────────────────

export interface EconomySnapshotSystem {
  systemId: string;
  systemName: string;
  economyType: string;
  markets: {
    goodId: string;
    goodName: string;
    supply: number;
    demand: number;
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
    markets: (sys.station?.markets ?? []).map((m) => ({
      goodId: m.goodId,
      goodName: m.good.name,
      supply: m.supply,
      demand: m.demand,
      price: calculatePrice(m.good.basePrice, m.supply, m.demand),
    })),
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

    let resetCount = 0;
    for (const m of markets) {
      const econ = m.station.system.economyType as EconomyType;
      const goodKey = goodKeyByName.get(m.good.name) ?? m.good.name;
      const produces = getProducedGoods(econ);
      const consumes = getConsumedGoods(econ);

      const isProduced = produces.includes(goodKey);
      const isConsumed = consumes.includes(goodKey);
      const target = isProduced
        ? EQUILIBRIUM_TARGETS.produces
        : isConsumed
          ? EQUILIBRIUM_TARGETS.consumes
          : EQUILIBRIUM_TARGETS.neutral;

      await tx.stationMarket.update({
        where: { id: m.id },
        data: { supply: target.supply, demand: target.demand },
      });
      resetCount++;
    }

    return { marketsReset: resetCount, eventsCleared: eventCount };
  });

  return { ok: true, data: result };
}

// ── Tick control ────────────────────────────────────────────────

export async function controlTick(params: {
  action: "pause" | "resume" | "setRate";
  tickRate?: number;
}): Promise<ServiceResult<{ tickRate: number; paused: boolean }>> {
  const world = await prisma.gameWorld.findUnique({ where: { id: "world" } });
  if (!world) {
    return { ok: false, error: "Game world not found." };
  }

  let newRate = world.tickRate;

  if (params.action === "pause") {
    // Use a very high tick rate as "paused" (effectively stops ticking)
    newRate = 999999999;
  } else if (params.action === "resume") {
    newRate = 5000;
  } else if (params.action === "setRate" && params.tickRate) {
    newRate = Math.max(500, Math.min(60000, params.tickRate));
  }

  await prisma.gameWorld.update({
    where: { id: "world" },
    data: { tickRate: newRate },
  });

  return {
    ok: true,
    data: { tickRate: newRate, paused: newRate >= 999999999 },
  };
}
