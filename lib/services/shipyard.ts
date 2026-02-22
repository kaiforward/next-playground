import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { validateShipPurchase } from "@/lib/engine/shipyard";
import { buildShipData, buildUpgradeSlots } from "@/lib/engine/ship-factory";
import type { ShipPurchaseResult } from "@/lib/types/api";

type PurchaseResult =
  | { ok: true; data: ShipPurchaseResult }
  | { ok: false; error: string; status: number };

/**
 * Purchase a new ship at a system's shipyard.
 * TOCTOU-safe: re-reads credits inside the transaction.
 */
export async function purchaseShip(
  playerId: string,
  systemId: string,
  shipType: string,
): Promise<PurchaseResult> {
  // Verify system exists
  const system = await prisma.starSystem.findUnique({
    where: { id: systemId },
    select: { id: true },
  });

  if (!system) {
    return { ok: false, error: "System not found.", status: 404 };
  }

  // Fetch player credits for pre-validation
  const player = await prisma.player.findUnique({
    where: { id: playerId },
    select: { id: true, credits: true },
  });

  if (!player) {
    return { ok: false, error: "Player not found.", status: 404 };
  }

  // Pre-transaction validation
  const validation = validateShipPurchase({
    shipType,
    playerCredits: player.credits,
  });

  if (!validation.ok) {
    return { ok: false, error: validation.error, status: 400 };
  }

  const { shipTypeDef, totalCost } = validation.data;

  // TOCTOU transaction: re-read credits, count ships for naming, create ship
  const newShip = await prisma.$transaction(async (tx) => {
    const freshPlayer = await tx.player.findUnique({
      where: { id: playerId },
      select: { credits: true },
    });

    if (!freshPlayer || freshPlayer.credits < totalCost) return null;

    // Count existing ships of this type for auto-naming
    const existingCount = await tx.ship.count({
      where: { playerId, shipType },
    });
    const shipName = `${shipTypeDef.name} #${existingCount + 1}`;

    await tx.player.update({
      where: { id: playerId },
      data: { credits: { increment: -totalCost } },
    });

    const shipData = buildShipData(shipTypeDef, shipName);
    const slotData = buildUpgradeSlots(shipTypeDef.slotLayout);

    return tx.ship.create({
      data: {
        ...shipData,
        playerId,
        systemId,
        upgradeSlots: { create: slotData },
      },
      include: {
        cargo: { include: { good: true } },
        system: true,
        destination: true,
        upgradeSlots: true,
        convoyMember: true,
      },
    });
  });

  if (!newShip) {
    return { ok: false, error: "State changed. Please try again.", status: 409 };
  }

  return {
    ok: true,
    data: {
      ship: serializeShip(newShip),
      creditSpent: totalCost,
    },
  };
}
