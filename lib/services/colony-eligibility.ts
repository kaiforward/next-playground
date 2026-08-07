/**
 * Shared colony-eligibility planning — world-state-in, data-out, no store access of its own. Both
 * the build-options read service and the construction-orders mutation service consume this so
 * neither depends on the other (a read service importing from a mutation service was a layering
 * smell); the same eligibility check backs the order's own validation and the UI's preview.
 *
 * Server-only, because pricing a colony reads `ECONOMY_SCALE`: the client never sees the scale, only
 * the resolved charter and material figures this service hands the API. The block-reason vocabulary
 * a client component does render lives apart in `lib/types/colonisation.ts`, which imports nothing.
 */
import type { World, WorldSystem } from "@/lib/world/types";
import { toTickConnections } from "@/lib/world/tick";
import { sizeColonyEstablish } from "@/lib/engine/directed-build";
import { boundedHopsFromOrigin } from "@/lib/engine/pathfinding";
import {
  charterFee, foundingCommitmentCost, foundingGoodsValue, projectedManifestWant,
  referenceMaintenanceBill,
} from "@/lib/engine/founding-cost";
import { foundingWorkingBalance } from "@/lib/engine/treasury";
import { ECONOMY_SCALE } from "@/lib/constants/economy-scale";
import { CYCLE_LENGTH } from "@/lib/constants/tick-cadence";
import { COLONISATION } from "@/lib/constants/colonisation";
import { EXPANSION } from "@/lib/constants/expansion";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import type { ColonyBlockReason } from "@/lib/types/colonisation";

/** The hop radius the tick's shared BFS uses — seed-source reach for the colony verb matches it. */
export const COLONY_REACH_HOPS = Math.max(
  DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS,
);

/**
 * Nearest developed same-faction seed source within the tick's reach radius, or null.
 *
 * Ties on hop count break to the **smallest system id**. The autonomic planner's own provider
 * (`developProvider`, `lib/world/tick.ts`) instead keeps the first tied system its hop-map
 * iteration reaches, so on an exact tie the player verb and the planner can name different
 * sources. Both are deterministic and an exact tie is rare, so they are deliberately left
 * unaligned; unify them behind one helper if anything ever keys off which specific source a
 * colony drew from.
 */
export function findSeedSource(world: World, factionId: string, systemId: string): string | null {
  const hops = boundedHopsFromOrigin(systemId, toTickConnections(world), COLONY_REACH_HOPS);
  let best: { id: string; h: number } | null = null;
  for (const s of world.systems) {
    if (s.factionId !== factionId || s.control !== "developed") continue;
    const h = hops.get(s.id);
    if (h === undefined || h <= 0) continue;
    if (best === null || h < best.h || (h === best.h && s.id < best.id)) best = { id: s.id, h };
  }
  return best?.id ?? null;
}

export function sizingParams(): { seedPop: number; establishWork: number } {
  return { seedPop: EXPANSION.COLONY_SEED_POP, establishWork: COLONISATION.COLONY_ESTABLISH_WORK };
}

/**
 * Planner-equivalent eligibility for the direct-colony verb at a CONTROLLED player system.
 *
 * The money gate runs last, once the physical gates have produced the seed sizing and the source the
 * price is quoted against. Charter and projected material bill come from `lib/engine/founding-cost` —
 * the same functions the autonomic planner's affordability gate calls, against the same working
 * balance the tick's founding path spends from (`balance − pendingFounding`) and the same
 * comparison the planner truncates its candidate list on — so a colony costs one number whoever
 * founds it. With colonisation automation off the planner never runs for the player's faction, so
 * without this gate the player would be the one faction that founds for free.
 *
 * `projectedBill` rides back out on the eligible branch so the caller prices the verb without
 * recomputing it. It is the UNCAPPED want — an upper bound, since what a founder can actually spare
 * over an establish's life is not knowable at commitment — which is why the UI labels it "up to".
 */
export function colonyEligibility(
  world: World, factionId: string, system: WorldSystem,
):
  | { eligible: true; sourceSystemId: string; charter: number; projectedBill: number }
  | { eligible: false; reason: ColonyBlockReason } {
  if (world.constructionProjects.some((p) => p.kind === "colony_establish" && p.systemId === system.id)) {
    return { eligible: false, reason: "already_forming" };
  }
  if (system.habitableSpace < EXPANSION.DEVELOP_HABITABLE_FLOOR) {
    return { eligible: false, reason: "below_habitable_floor" };
  }
  const sizing = sizeColonyEstablish(system.habitableSpace, sizingParams());
  if (sizing === null) {
    return { eligible: false, reason: "below_habitable_floor" };
  }
  const source = findSeedSource(world, factionId, system.id);
  if (source === null) return { eligible: false, reason: "no_seed_source" };

  const treasury = world.treasuries.find((t) => t.factionId === factionId);
  // De-scaled to a REFERENCE cycle through the same helper the tick quotes the planner's charter
  // with, so a cadence change can never move the player's price and not the planner's.
  const referenceBill = referenceMaintenanceBill(treasury?.lastSettlement?.maintenanceBill, CYCLE_LENGTH);
  const charter = charterFee(referenceBill, {
    mult: COLONISATION.CHARTER_FEE_SPEND_MULT, min: COLONISATION.CHARTER_FEE_MIN,
  });
  const projectedBill = foundingGoodsValue(
    projectedManifestWant(
      world.markets.filter((m) => m.systemId === source),
      sizing.seedPop,
      COLONISATION.FOUNDING_STOCK_COVER,
    ),
    ECONOMY_SCALE,
  );
  const workingBalance =
    treasury === undefined ? 0 : foundingWorkingBalance(treasury.balance, treasury.pendingFounding);
  const cost = foundingCommitmentCost(charter, projectedBill, COLONISATION.FOUNDING_GATE_HEADROOM);
  if (cost > workingBalance) return { eligible: false, reason: "insufficient_funds" };

  return { eligible: true, sourceSystemId: source, charter, projectedBill };
}
