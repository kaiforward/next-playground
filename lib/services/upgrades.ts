import { prisma } from "@/lib/prisma";
import { serializeShip } from "@/lib/auth/serialize";
import { validateUpgradeInstallation } from "@/lib/engine/upgrades";
import { MODULES, type ModuleId, getModuleCost } from "@/lib/constants/modules";
import { SHIP_INCLUDE } from "./fleet";
import type { ShipState } from "@/lib/types/game";

type UpgradeResult =
  | { ok: true; data: { ship: ShipState; creditSpent: number } }
  | { ok: false; error: string; status: number };

type RemoveResult =
  | { ok: true; data: { ship: ShipState } }
  | { ok: false; error: string; status: number };

/**
 * Install an upgrade module into a ship's slot.
 * TOCTOU-safe: re-reads credits and slot state inside transaction.
 */
export async function installUpgrade(
  playerId: string,
  shipId: string,
  slotId: string,
  moduleId: string,
  tier: number = 1,
): Promise<UpgradeResult> {
  // Pre-validate module
  const moduleDef = MODULES[moduleId as ModuleId];
  if (!moduleDef) {
    return { ok: false, error: `Unknown module: "${moduleId}".`, status: 400 };
  }

  const cost = getModuleCost(moduleId as ModuleId, tier);
  if (cost <= 0) {
    return { ok: false, error: `Invalid tier ${tier} for ${moduleDef.name}.`, status: 400 };
  }

  const result = await prisma.$transaction(async (tx) => {
    const ship = await tx.ship.findUnique({
      where: { id: shipId },
      select: { playerId: true, status: true, disabled: true },
    });

    if (!ship || ship.playerId !== playerId) {
      return { ok: false as const, error: "Ship not found or not yours.", status: 404 };
    }

    if (ship.status !== "docked") {
      return { ok: false as const, error: "Ship must be docked to install upgrades.", status: 400 };
    }

    if (ship.disabled) {
      return { ok: false as const, error: "Cannot install upgrades on a disabled ship.", status: 400 };
    }

    const slot = await tx.shipUpgradeSlot.findUnique({
      where: { id: slotId },
    });

    if (!slot || slot.shipId !== shipId) {
      return { ok: false as const, error: "Upgrade slot not found on this ship.", status: 404 };
    }

    // Validate module fits in this slot type
    const validation = validateUpgradeInstallation({
      moduleId,
      moduleTier: tier,
      slotType: slot.slotType,
    });

    if (!validation.ok) {
      return { ok: false as const, error: validation.error, status: 400 };
    }

    // Check credits
    const player = await tx.player.findUnique({
      where: { id: playerId },
      select: { credits: true },
    });

    if (!player || player.credits < cost) {
      return { ok: false as const, error: `Not enough credits. Need ${cost}, have ${player?.credits ?? 0}.`, status: 400 };
    }

    // Deduct credits and install
    await tx.player.update({
      where: { id: playerId },
      data: { credits: { increment: -cost } },
    });

    await tx.shipUpgradeSlot.update({
      where: { id: slotId },
      data: { moduleId, moduleTier: tier },
    });

    const updatedShip = await tx.ship.findUnique({
      where: { id: shipId },
      include: SHIP_INCLUDE,
    });

    return { ok: true as const, data: { ship: serializeShip(updatedShip!), creditSpent: cost } };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}

/**
 * Remove an upgrade module from a ship's slot.
 * No refund — module is destroyed.
 */
export async function removeUpgrade(
  playerId: string,
  shipId: string,
  slotId: string,
): Promise<RemoveResult> {
  const result = await prisma.$transaction(async (tx) => {
    const ship = await tx.ship.findUnique({
      where: { id: shipId },
      select: { playerId: true, status: true },
    });

    if (!ship || ship.playerId !== playerId) {
      return { ok: false as const, error: "Ship not found or not yours.", status: 404 };
    }

    if (ship.status !== "docked") {
      return { ok: false as const, error: "Ship must be docked to remove upgrades.", status: 400 };
    }

    const slot = await tx.shipUpgradeSlot.findUnique({
      where: { id: slotId },
    });

    if (!slot || slot.shipId !== shipId) {
      return { ok: false as const, error: "Upgrade slot not found on this ship.", status: 404 };
    }

    if (!slot.moduleId) {
      return { ok: false as const, error: "Slot is already empty.", status: 400 };
    }

    await tx.shipUpgradeSlot.update({
      where: { id: slotId },
      data: { moduleId: null, moduleTier: null },
    });

    const updatedShip = await tx.ship.findUnique({
      where: { id: shipId },
      include: SHIP_INCLUDE,
    });

    return { ok: true as const, data: { ship: serializeShip(updatedShip!) } };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}
