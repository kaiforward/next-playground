import { prisma } from "@/lib/prisma";
import { computeConvoyRepairPlan } from "@/lib/engine/convoy-repair";

type ConvoyRepairResult =
  | { ok: true; data: { totalCost: number; totalHealed: number } }
  | { ok: false; error: string; status: number };

/**
 * Repair all ships in a convoy by a given fraction of their individual damage.
 * TOCTOU-safe: all reads and writes inside a single transaction.
 */
export async function repairConvoy(
  playerId: string,
  convoyId: string,
  fraction: number,
): Promise<ConvoyRepairResult> {
  if (typeof fraction !== "number" || fraction <= 0 || fraction > 1) {
    return { ok: false, error: "Fraction must be between 0 and 1.", status: 400 };
  }

  const result = await prisma.$transaction(async (tx) => {
    const convoy = await tx.convoy.findUnique({
      where: { id: convoyId },
      select: {
        playerId: true,
        status: true,
        members: {
          include: {
            ship: { select: { id: true, name: true, hullMax: true, hullCurrent: true, disabled: true } },
          },
        },
      },
    });

    if (!convoy || convoy.playerId !== playerId) {
      return { ok: false as const, error: "Convoy not found.", status: 404 };
    }

    if (convoy.status !== "docked") {
      return { ok: false as const, error: "Convoy must be docked to repair.", status: 400 };
    }

    const ships = convoy.members.map((m) => m.ship);
    const plan = computeConvoyRepairPlan(ships, fraction);

    if (plan.totalCost <= 0) {
      return { ok: false as const, error: "No ships need repair.", status: 400 };
    }

    const player = await tx.player.findUnique({
      where: { id: playerId },
      select: { credits: true },
    });

    if (!player || player.credits < plan.totalCost) {
      return {
        ok: false as const,
        error: `Not enough credits. Need ${plan.totalCost}, have ${player?.credits ?? 0}.`,
        status: 400,
      };
    }

    // Deduct credits
    await tx.player.update({
      where: { id: playerId },
      data: { credits: { increment: -plan.totalCost } },
    });

    // Apply per-ship repairs
    for (const shipPlan of plan.ships) {
      if (shipPlan.healAmount <= 0) continue;

      // Re-enable disabled ships if hull goes above 0
      const ship = ships.find((s) => s.id === shipPlan.shipId)!;
      await tx.ship.update({
        where: { id: shipPlan.shipId },
        data: {
          hullCurrent: { increment: shipPlan.healAmount },
          ...(ship.disabled && shipPlan.hullAfter > 0 ? { disabled: false } : {}),
        },
      });
    }

    return {
      ok: true as const,
      data: { totalCost: plan.totalCost, totalHealed: plan.totalHealed },
    };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}
