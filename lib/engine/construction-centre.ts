/**
 * Pure Construction Centre valuation — zero DB dependency.
 *
 * A centre serves no market demand, so it carries no invented value: a construction point is worth
 * the best work the pool can't yet fund. Per faction per pulse, the backlog (in-flight projects +
 * this pulse's ordered proposals) is walked in funding order against the work the pool drains within
 * BACKLOG_WINDOW reference months; the best ROI beyond that frontier prices at most ONE centre
 * proposal, which then competes on the ordinary ROI ordering. Emergent, self-limiting: a deep
 * valuable backlog funds a centre; a draining queue or junk backlog never does; a landed centre
 * grows the pool and pushes the frontier out. All quantities here are reference-month units — the
 * caller passes the UNSCALED pool (catchUp scaling is a funding concern, not a valuation one).
 */
import type { WorldConstructionProject } from "@/lib/world/types";
import type { BuildProposal, BuildSystemState, Proposal } from "@/lib/engine/directed-build";
import { proposalRoi } from "@/lib/engine/construction";
import { generalSpaceUsed, labourDemand } from "@/lib/engine/industry";
import { isEconomicallyActive } from "@/lib/engine/control";
import { BUILDING_TYPES, CONSTRUCTION_CENTRE_TYPE, effectiveSpaceCost } from "@/lib/constants/industry";
import { workCostPerLevel } from "@/lib/constants/construction";

export interface CentreValuationParams {
  /** Points one fully-staffed centre level yields per reference month (CONSTRUCTION.POINTS_PER_LEVEL). */
  pointsPerLevel: number;
  /** Reference months of output the centre's value amortises (CONSTRUCTION.PAYBACK_HORIZON). */
  paybackHorizon: number;
  /** Reference months of pool drain that define the funding frontier (CONSTRUCTION.BACKLOG_WINDOW). */
  backlogWindow: number;
}

/** General space a queued build order will consume when it lands. Tier-0 sits on deposit slots → 0. */
function queuedSpace(buildingType: string, levels: number): number {
  if (BUILDING_TYPES[buildingType]?.resource) return 0;
  return levels * effectiveSpaceCost(buildingType);
}

/**
 * Price and site at most one Construction Centre proposal for a faction this pulse, or null when the
 * backlog drains inside the window, a centre is already in flight, or no developed system can host
 * one. `ordered` is this pulse's proposals in funding order; `pool` is the faction's unscaled
 * reference-month construction pool.
 */
export function planCentreProposal(
  factionId: string,
  ordered: Proposal[],
  openProjects: WorldConstructionProject[],
  systems: BuildSystemState[],
  pool: number,
  params: CentreValuationParams,
): BuildProposal | null {
  // One centre in flight at a time — the landed pool growth must re-price the next one.
  if (openProjects.some((p) => p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE)) {
    return null;
  }

  // Frontier: cumulative work in funding order (in-flight first) vs the window's drainable budget.
  // A proposal whose cumulative work exceeds the budget cannot fund inside the window — starved.
  const budget = Math.max(0, pool) * params.backlogWindow;
  let cumulative = 0;
  for (const p of openProjects) cumulative += Math.max(0, p.workTotal - p.workDone);
  let bestStarvedRoi = 0;
  for (const p of ordered) {
    cumulative += p.work;
    if (cumulative > budget) bestStarvedRoi = Math.max(bestStarvedRoi, proposalRoi(p));
  }
  if (bestStarvedRoi <= 0) return null;

  // Siting: the developed system with the most spare labour that can physically host the centre,
  // net of space already committed by the queue and this pulse's proposals. Deterministic: spare
  // labour desc → remaining space desc → systemId asc.
  const committedSpace = new Map<string, number>();
  for (const p of openProjects) {
    if (p.kind !== "build") continue;
    committedSpace.set(p.systemId, (committedSpace.get(p.systemId) ?? 0) + queuedSpace(p.buildingType, p.levels));
  }
  for (const p of ordered) {
    if (p.kind !== "build") continue;
    let space = 0;
    for (const item of p.items) space += queuedSpace(item.buildingType, item.levels);
    committedSpace.set(p.systemId, (committedSpace.get(p.systemId) ?? 0) + space);
  }

  const footprint = effectiveSpaceCost(CONSTRUCTION_CENTRE_TYPE);
  let site: { systemId: string; spare: number; space: number } | null = null;
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    const space = s.generalSpace - generalSpaceUsed(s.buildings) - (committedSpace.get(s.systemId) ?? 0);
    if (space < footprint) continue;
    const spare = Math.max(0, s.population - labourDemand(s.buildings));
    if (
      site === null ||
      spare > site.spare ||
      (spare === site.spare && (space > site.space || (space === site.space && s.systemId < site.systemId)))
    ) {
      site = { systemId: s.systemId, spare, space };
    }
  }
  if (site === null) return null;

  return {
    kind: "build",
    factionId,
    systemId: site.systemId,
    role: "industry",
    items: [{ buildingType: CONSTRUCTION_CENTRE_TYPE, levels: 1 }],
    value: params.pointsPerLevel * bestStarvedRoi * params.paybackHorizon,
    work: workCostPerLevel(CONSTRUCTION_CENTRE_TYPE),
  };
}
