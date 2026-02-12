import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { validateRefuel } from "@/lib/engine/refuel";
import { REFUEL_COST_PER_UNIT } from "@/lib/constants/fuel";
import type { ShipRefuelResult } from "@/lib/types/api";

type RefuelResult =
  | { ok: true; data: ShipRefuelResult }
  | { ok: false; error: string; status: number };

/**
 * Execute a refuel operation for a specific ship.
 * TOCTOU-safe: re-reads credits and fuel inside the transaction.
 */
export async function executeRefuel(
  playerId: string,
  shipId: string,
  amount: number,
): Promise<RefuelResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: "Amount must be a positive integer.", status: 400 };
  }

  // Fetch player + ship, verify ownership
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, credits: true },
  });

  if (!player) {
    return { ok: false, error: "Player not found.", status: 404 };
  }

  const ship = await prisma.ship.findUnique({
    where: { id: shipId },
    select: { id: true, playerId: true, fuel: true, maxFuel: true, status: true },
  });

  if (!ship || ship.playerId !== playerId) {
    return { ok: false, error: "Ship not found or does not belong to you.", status: 404 };
  }

  // Pre-transaction validation
  const validation = validateRefuel({
    fuel: ship.fuel,
    maxFuel: ship.maxFuel,
    shipStatus: ship.status as "docked" | "in_transit",
    amount,
    playerCredits: player.credits,
    costPerUnit: REFUEL_COST_PER_UNIT,
  });

  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  const { fuelToAdd, totalCost } = validation.data;

  // TOCTOU transaction: re-read and apply atomically
  const updatedShip = await prisma.$transaction(async (tx) => {
    const freshPlayer = await tx.player.findUnique({
      where: { id: playerId },
      select: { credits: true },
    });
    const freshShip = await tx.ship.findUnique({
      where: { id: shipId },
      select: { fuel: true, maxFuel: true, status: true },
    });

    if (!freshPlayer || !freshShip) return null;
    if (freshShip.status !== "docked") return null;
    if (freshPlayer.credits < totalCost) return null;
    if (freshShip.fuel + fuelToAdd > freshShip.maxFuel) return null;

    await tx.player.update({
      where: { id: playerId },
      data: { credits: { increment: -totalCost } },
    });

    return tx.ship.update({
      where: { id: shipId },
      data: { fuel: { increment: fuelToAdd } },
      include: {
        cargo: { include: { good: true } },
        system: true,
        destination: true,
      },
    });
  });

  if (!updatedShip) {
    return { ok: false, error: "State changed. Please try again.", status: 409 };
  }

  return {
    ok: true,
    data: {
      ship: serializeShip(updatedShip),
      creditSpent: totalCost,
    },
  };
}
