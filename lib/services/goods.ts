import { prisma } from "@/lib/prisma";
import { ServiceError } from "./errors";
import type { GoodInfo, GoodTier } from "@/lib/types/game";

function toGoodTier(tier: number): GoodTier {
  if (tier === 0 || tier === 1 || tier === 2) return tier;
  throw new ServiceError(`Invalid good tier in DB: ${tier}`, 500);
}

/**
 * Returns the universal goods catalog. Goods are static — seeded once and
 * never mutated at runtime — so this is safe to cache aggressively on the
 * client. Sorted by tier ascending then name for stable picker ordering.
 */
export async function getGoods(): Promise<GoodInfo[]> {
  const rows = await prisma.good.findMany({
    select: { id: true, name: true, tier: true, basePrice: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      basePrice: r.basePrice,
      tier: toGoodTier(r.tier),
    }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
}
