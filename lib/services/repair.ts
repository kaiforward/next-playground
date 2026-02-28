import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { calculateRepairCost } from "@/lib/engine/damage";
import { SHIP_INCLUDE } from "./fleet";
import type { ShipState } from "@/lib/types/game";

type RepairResult =
  | { ok: true; data: { ship: ShipState; creditSpent: number } }
  | { ok: false; error: string; status: number };

/**
 * Repair a ship to full hull. Shields regenerate for free on dock.
 * TOCTOU-safe: re-reads credits and hull inside transaction.
 */
export async function repairShip(
  playerId: string,
  shipId: string,
): Promise<RepairResult> {
  // Pre-fetch for early validation
  const ship = await prisma.ship.findUnique({
    where: { id: shipId },
    select: { id: true, playerId: true, status: true, hullMax: true, hullCurrent: true },
  });

  if (!ship || ship.playerId !== playerId) {
    return { ok: false, error: "Ship not found or not yours.", status: 404 };
  }

  if (ship.status !== "docked") {
    return { ok: false, error: "Ship must be docked to repair.", status: 400 };
  }

  if (ship.hullCurrent >= ship.hullMax) {
    return { ok: false, error: "Ship hull is already at maximum.", status: 400 };
  }

  const result = await prisma.$transaction(async (tx) => {
    const freshShip = await tx.ship.findUnique({
      where: { id: shipId },
      select: { status: true, hullMax: true, hullCurrent: true, disabled: true },
    });

    if (!freshShip || freshShip.status !== "docked") {
      return { ok: false as const, error: "Ship state changed.", status: 409 };
    }

    const freshCost = calculateRepairCost(freshShip.hullMax, freshShip.hullCurrent);
    if (freshCost.totalCost <= 0) {
      return { ok: false as const, error: "Ship hull is already at maximum.", status: 400 };
    }

    const player = await tx.player.findUnique({
      where: { id: playerId },
      select: { credits: true },
    });

    if (!player || player.credits < freshCost.totalCost) {
      return {
        ok: false as const,
        error: `Not enough credits. Need ${freshCost.totalCost}, have ${player?.credits ?? 0}.`,
        status: 400,
      };
    }

    await tx.player.update({
      where: { id: playerId },
      data: { credits: { increment: -freshCost.totalCost } },
    });

    const updatedShip = await tx.ship.update({
      where: { id: shipId },
      data: {
        hullCurrent: freshShip.hullMax,
        disabled: false,
      },
      include: SHIP_INCLUDE,
    });

    return {
      ok: true as const,
      data: { ship: serializeShip(updatedShip), creditSpent: freshCost.totalCost },
    };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}
