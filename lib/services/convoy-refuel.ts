import { prisma } from "@/lib/prisma";
import { computeConvoyRefuelPlan } from "@/lib/engine/convoy-refuel";

type ConvoyRefuelResult =
  | { ok: true; data: { totalCost: number; totalFueled: number } }
  | { ok: false; error: string; status: number };

/**
 * Refuel all ships in a convoy by a given fraction of their individual missing fuel.
 * TOCTOU-safe: all reads and writes inside a single transaction.
 */
export async function refuelConvoy(
  playerId: string,
  convoyId: string,
  fraction: number,
): Promise<ConvoyRefuelResult> {
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
            ship: { select: { id: true, name: true, fuel: true, maxFuel: true } },
          },
        },
      },
    });

    if (!convoy || convoy.playerId !== playerId) {
      return { ok: false as const, error: "Convoy not found.", status: 404 };
    }

    if (convoy.status !== "docked") {
      return { ok: false as const, error: "Convoy must be docked to refuel.", status: 400 };
    }

    const ships = convoy.members.map((m) => m.ship);
    const plan = computeConvoyRefuelPlan(ships, fraction);

    if (plan.totalCost <= 0) {
      return { ok: false as const, error: "No ships need fuel.", status: 400 };
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

    // Apply per-ship fuel
    for (const shipPlan of plan.ships) {
      if (shipPlan.fuelAmount <= 0) continue;

      await tx.ship.update({
        where: { id: shipPlan.shipId },
        data: { fuel: { increment: shipPlan.fuelAmount } },
      });
    }

    return {
      ok: true as const,
      data: { totalCost: plan.totalCost, totalFueled: plan.totalFuel },
    };
  });

  if (!result.ok) return result;
  return { ok: true, data: result.data };
}
