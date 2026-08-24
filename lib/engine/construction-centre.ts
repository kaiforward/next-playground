/**
 * Pure Construction Centre valuation — zero DB dependency.
 *
 * A centre serves no market demand, so it carries no invented value: a construction point is worth
 * the best work the pool can't yet fund. Per faction per cycle, the backlog (in-flight projects +
 * this cycle's ordered proposals) is walked in funding order against the work the pool drains within
 * BACKLOG_WINDOW reference cycles; the best ROI beyond that frontier prices at most ONE centre
 * proposal, which then competes on the ordinary ROI ordering. Emergent, self-limiting: a deep
 * valuable backlog funds a centre; a draining queue or junk backlog never does; a landed centre
 * grows the pool and pushes the frontier out. All quantities here are reference-cycle units — the
 * caller passes the UNSCALED pool (catchUp scaling is a funding concern, not a valuation one).
 */
import type { WorldConstructionProject } from "@/lib/world/types";
import type { BuildProposal, BuildSystemState, Proposal } from "@/lib/engine/directed-build";
import { proposalRoi } from "@/lib/engine/construction";
import { labourDemand } from "@/lib/engine/industry";
import { isEconomicallyActive } from "@/lib/engine/control";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
import { workCostPerLevel } from "@/lib/constants/construction";

export interface CentreValuationParams {
  /** Points one fully-staffed centre level yields per reference cycle (CONSTRUCTION.POINTS_PER_LEVEL). */
  pointsPerLevel: number;
  /** Reference cycles of output the centre's value amortises (CONSTRUCTION.PAYBACK_HORIZON). */
  paybackHorizon: number;
  /** Reference cycles of pool drain that define the funding frontier (CONSTRUCTION.BACKLOG_WINDOW). */
  backlogWindow: number;
}

/**
 * Price and site at most one Construction Centre proposal for a faction this cycle, or null when the
 * backlog drains inside the window, a centre is already in flight, or no developed system can host
 * one. `ordered` is this cycle's proposals in funding order; `pool` is the faction's unscaled
 * reference-cycle construction pool.
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

  // Siting: the developed system with the most spare labour — a centre bills no land at all, so
  // nothing here needs to reserve space against the queue or this cycle's proposals. Deterministic:
  // spare labour desc → systemId asc.
  let site: { systemId: string; spare: number } | null = null;
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    const spare = Math.max(0, s.population - labourDemand(s.buildings));
    if (
      site === null ||
      spare > site.spare ||
      (spare === site.spare && s.systemId < site.systemId)
    ) {
      site = { systemId: s.systemId, spare };
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
