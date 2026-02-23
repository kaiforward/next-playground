import { prisma } from "@/lib/prisma";
import { serializeConvoy } from "@/lib/auth/serialize";
import { validateFleetRouteNavigation } from "@/lib/engine/navigation";
import { SHIP_INCLUDE } from "./fleet";
import type { ConvoyState } from "@/lib/types/game";

// ── Shared convoy include ───────────────────────────────────────

const CONVOY_INCLUDE = {
  system: true,
  destination: true,
  members: {
    include: {
      ship: { include: SHIP_INCLUDE },
    },
  },
} as const;

// ── Result types ────────────────────────────────────────────────

type ConvoyResult =
  | { ok: true; data: ConvoyState }
  | { ok: false; error: string; status: number };

type ConvoyListResult =
  | { ok: true; data: ConvoyState[] }
  | { ok: false; error: string; status: number };

type ConvoyNavigateResult =
  | { ok: true; data: { convoy: ConvoyState; fuelUsed: number; travelDuration: number } }
  | { ok: false; error: string; status: number };

// ── List convoys ────────────────────────────────────────────────

export async function listConvoys(playerId: string): Promise<ConvoyListResult> {
  const convoys = await prisma.convoy.findMany({
    where: { playerId },
    include: CONVOY_INCLUDE,
  });

  return { ok: true, data: convoys.map(serializeConvoy) };
}

// ── Create convoy ───────────────────────────────────────────────

export async function createConvoy(
  playerId: string,
  shipIds: string[],
  name?: string,
): Promise<ConvoyResult> {
  if (!shipIds || shipIds.length < 2) {
    return { ok: false, error: "A convoy requires at least 2 ships.", status: 400 };
  }

  const result = await prisma.$transaction(async (tx) => {
    // Verify all ships belong to player, are docked, at same system, not in a convoy, not disabled
    const ships = await tx.ship.findMany({
      where: { id: { in: shipIds }, playerId },
      select: { id: true, status: true, systemId: true, disabled: true, convoyMember: true },
    });

    if (ships.length !== shipIds.length) {
      return { ok: false as const, error: "One or more ships not found or not yours.", status: 404 };
    }

    const disabled = ships.find((s) => s.disabled);
    if (disabled) {
      return { ok: false as const, error: "Cannot add disabled ships to a convoy.", status: 400 };
    }

    const notDocked = ships.find((s) => s.status !== "docked");
    if (notDocked) {
      return { ok: false as const, error: "All ships must be docked to form a convoy.", status: 400 };
    }

    const systems = new Set(ships.map((s) => s.systemId));
    if (systems.size > 1) {
      return { ok: false as const, error: "All ships must be at the same system.", status: 400 };
    }

    const inConvoy = ships.find((s) => s.convoyMember !== null);
    if (inConvoy) {
      return { ok: false as const, error: "One or more ships are already in a convoy.", status: 400 };
    }

    const systemId = ships[0].systemId;
    const convoy = await tx.convoy.create({
      data: {
        playerId,
        name: name || null,
        systemId,
        status: "docked",
        members: {
          create: shipIds.map((shipId) => ({ shipId })),
        },
      },
      include: CONVOY_INCLUDE,
    });

    return { ok: true as const, data: serializeConvoy(convoy) };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

// ── Disband convoy ──────────────────────────────────────────────

export async function disbandConvoy(
  playerId: string,
  convoyId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  return prisma.$transaction(async (tx) => {
    const convoy = await tx.convoy.findUnique({
      where: { id: convoyId },
      select: { playerId: true, status: true },
    });

    if (!convoy || convoy.playerId !== playerId) {
      return { ok: false as const, error: "Convoy not found.", status: 404 };
    }

    if (convoy.status !== "docked") {
      return { ok: false as const, error: "Cannot disband a convoy that is in transit.", status: 400 };
    }

    await tx.convoy.delete({ where: { id: convoyId } });
    return { ok: true as const };
  });
}

// ── Add ship to convoy ──────────────────────────────────────────

export async function addToConvoy(
  playerId: string,
  convoyId: string,
  shipId: string,
): Promise<ConvoyResult> {
  const result = await prisma.$transaction(async (tx) => {
    const convoy = await tx.convoy.findUnique({
      where: { id: convoyId },
      select: { playerId: true, status: true, systemId: true },
    });

    if (!convoy || convoy.playerId !== playerId) {
      return { ok: false as const, error: "Convoy not found.", status: 404 };
    }

    if (convoy.status !== "docked") {
      return { ok: false as const, error: "Cannot modify a convoy in transit.", status: 400 };
    }

    const ship = await tx.ship.findUnique({
      where: { id: shipId },
      select: { id: true, playerId: true, status: true, systemId: true, disabled: true, convoyMember: true },
    });

    if (!ship || ship.playerId !== playerId) {
      return { ok: false as const, error: "Ship not found or not yours.", status: 404 };
    }

    if (ship.disabled) {
      return { ok: false as const, error: "Cannot add a disabled ship to a convoy.", status: 400 };
    }

    if (ship.status !== "docked") {
      return { ok: false as const, error: "Ship must be docked.", status: 400 };
    }

    if (ship.systemId !== convoy.systemId) {
      return { ok: false as const, error: "Ship must be at the same system as the convoy.", status: 400 };
    }

    if (ship.convoyMember !== null) {
      return { ok: false as const, error: "Ship is already in a convoy.", status: 400 };
    }

    await tx.convoyMember.create({ data: { convoyId, shipId } });

    const updated = await tx.convoy.findUnique({
      where: { id: convoyId },
      include: CONVOY_INCLUDE,
    });

    return { ok: true as const, data: serializeConvoy(updated!) };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

// ── Remove ship from convoy ─────────────────────────────────────

export async function removeFromConvoy(
  playerId: string,
  convoyId: string,
  shipId: string,
): Promise<ConvoyResult | { ok: true; data: null }> {
  const result = await prisma.$transaction(async (tx) => {
    const convoy = await tx.convoy.findUnique({
      where: { id: convoyId },
      select: { playerId: true, status: true },
    });

    if (!convoy || convoy.playerId !== playerId) {
      return { ok: false as const, error: "Convoy not found.", status: 404 };
    }

    if (convoy.status !== "docked") {
      return { ok: false as const, error: "Cannot modify a convoy in transit.", status: 400 };
    }

    const member = await tx.convoyMember.findFirst({
      where: { convoyId, shipId },
    });

    if (!member) {
      return { ok: false as const, error: "Ship is not in this convoy.", status: 400 };
    }

    await tx.convoyMember.delete({ where: { id: member.id } });

    // Auto-disband if fewer than 2 members remain
    const remainingCount = await tx.convoyMember.count({ where: { convoyId } });
    if (remainingCount < 2) {
      await tx.convoy.delete({ where: { id: convoyId } });
      return { ok: true as const, data: null };
    }

    const updated = await tx.convoy.findUnique({
      where: { id: convoyId },
      include: CONVOY_INCLUDE,
    });

    return { ok: true as const, data: serializeConvoy(updated!) };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

// ── Navigate convoy ─────────────────────────────────────────────

export async function navigateConvoy(
  playerId: string,
  convoyId: string,
  route: string[],
): Promise<ConvoyNavigateResult> {
  if (
    !route ||
    !Array.isArray(route) ||
    route.length < 2 ||
    !route.every((id) => typeof id === "string" && id.length > 0)
  ) {
    return { ok: false, error: "Missing or invalid route.", status: 400 };
  }

  const result = await prisma.$transaction(async (tx) => {
    const convoy = await tx.convoy.findUnique({
      where: { id: convoyId },
      include: {
        members: {
          include: {
            ship: { select: { id: true, fuel: true, speed: true, status: true, systemId: true, disabled: true } },
          },
        },
      },
    });

    if (!convoy || convoy.playerId !== playerId) {
      return { ok: false as const, error: "Convoy not found.", status: 404 };
    }

    if (convoy.status !== "docked") {
      return { ok: false as const, error: "Convoy is already in transit.", status: 400 };
    }

    if (route[0] !== convoy.systemId) {
      return { ok: false as const, error: "Route must start at the convoy's current system.", status: 400 };
    }

    const ships = convoy.members.map((m) => m.ship);
    const disabledShip = ships.find((s) => s.disabled);
    if (disabledShip) {
      return { ok: false as const, error: "Convoy contains disabled ships. Repair or remove them first.", status: 400 };
    }

    // Convoy travels at slowest member's speed
    const slowestSpeed = Math.min(...ships.map((s) => s.speed));
    // Convoy fuel limited by the ship with least fuel
    const minFuel = Math.min(...ships.map((s) => s.fuel));

    const world = await tx.gameWorld.findUnique({ where: { id: "world" } });
    if (!world) {
      return { ok: false as const, error: "Game world not initialized.", status: 500 };
    }

    const connections = await tx.systemConnection.findMany({
      select: { fromSystemId: true, toSystemId: true, fuelCost: true },
    });

    const navResult = validateFleetRouteNavigation({
      route,
      connections,
      currentFuel: minFuel,
      shipStatus: "docked",
      currentTick: world.currentTick,
      shipSpeed: slowestSpeed,
    });

    if (!navResult.ok) {
      return { ok: false as const, error: navResult.error, status: 400 };
    }

    // Deduct fuel from all ships and set in_transit
    for (const ship of ships) {
      await tx.ship.update({
        where: { id: ship.id },
        data: {
          fuel: ship.fuel - navResult.totalFuelCost,
          status: "in_transit",
          destinationSystemId: navResult.destinationSystemId,
          departureTick: navResult.departureTick,
          arrivalTick: navResult.arrivalTick,
        },
      });
    }

    // Update convoy status
    const updatedConvoy = await tx.convoy.update({
      where: { id: convoyId },
      data: {
        status: "in_transit",
        destinationSystemId: navResult.destinationSystemId,
        departureTick: navResult.departureTick,
        arrivalTick: navResult.arrivalTick,
      },
      include: CONVOY_INCLUDE,
    });

    return {
      ok: true as const,
      data: {
        convoy: serializeConvoy(updatedConvoy),
        fuelUsed: navResult.totalFuelCost,
        travelDuration: navResult.totalTravelDuration,
      },
    };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}
