import type {
  FoundingStagingEvent, FoundingStallEvent, TickContext, TickProcessorResult,
} from "../types";
import { cycleStartShard, catchUpFactor } from "@/lib/tick/shard";
import {
  planFactionProposals, planFactionColonyProposals, assessColonyCandidates, planLaneUpgradeProposals,
  type BuildSystemState, type ColonyProposal, type ColonyEstablishCandidate, type ColonyEstablishParams,
  type LaneUpgradeProposal,
} from "@/lib/engine/directed-build";
import { fundQueueWithFloor, developmentFloorShare, factionConstructionPool, orderProposals, orderOpenProjects } from "@/lib/engine/construction";
import { planCentreProposal } from "@/lib/engine/construction-centre";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
import { GOODS } from "@/lib/constants/goods";
import { systemDevelopment } from "@/lib/engine/development";
import { isEconomicallyActive } from "@/lib/engine/control";
import { workCostPerLevel } from "@/lib/constants/construction";
import { surplusDrawable, type GoodMarketState } from "@/lib/engine/directed-logistics";
import type { RouteCost } from "@/lib/engine/directed-build";
import { COLONISATION } from "@/lib/constants/colonisation";
import { charterFee, foundingGoodsValue, stagingShareLines } from "@/lib/engine/founding-cost";
import { foundingWorkingBalance, safeMoney } from "@/lib/engine/treasury";
import { clamp } from "@/lib/utils/math";
import type { WorldConstructionProject, WorldColonyEstablishProject, WorldPlayer } from "@/lib/world/types";
import { LANES } from "@/lib/constants/lanes";
import type { LaneEndpointOwner, LaneLevelIncrease } from "@/lib/engine/lanes";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
  FoundingStockLine,
  FoundingStagingDraw,
  ProposalPersistenceUpdate,
  BuildBlockedUpdate,
  BuildOpportunityUpdate,
  ColonyOpportunityUpdate,
} from "@/lib/tick/world/directed-build-world";
import {
  proposeFactionClaims,
  resolveClaims,
  type ClaimCandidate,
  type ClaimProposal,
  type ExpansionParams,
} from "@/lib/engine/expansion";
import type { RNG } from "@/lib/engine/universe-gen";

export interface DirectedBuildProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
  /** Construction funding: the per-build absorption cap, the pool rate per pop, and a unique-id minter. */
  construction: {
    /** Most construction points one build can absorb per cycle (sets the minimum build time). */
    cap: number;
    /** Construction points a faction's pool gains per unit population per cycle. */
    throughputPerPop: number;
    /** Max pool-floor points reserved per young colony at development 0 (§7.9). 0 disables the floor. */
    floorBase: number;
    /** Development at which a colony weans fully off the pool floor. */
    floorKnee: number;
    /** Points one fully-staffed Construction Centre level adds per reference cycle. */
    pointsPerLevel: number;
    /** Reference cycles of centre output its proposal value amortises. */
    paybackHorizon: number;
    /** Reference cycles of pool drain defining the centre-valuation frontier. */
    backlogWindow: number;
    /** Mints a unique id for each newly-committed project (backed by the world's nextId counter). */
    mintId: () => string;
  };
  /** Claim step (control tier). Omitted → no claim phase (the build-only path used by engine/adapter tests). */
  claim?: {
    reachProvider: (factionId: string) => ClaimCandidate[];
    rng: RNG;
    params: ExpansionParams;
  };
  /** Colony-establish step. Omitted → no colonisation (build-only path used by engine/adapter tests). */
  develop?: {
    /** Controlled colony candidates per faction (substrate + seed source), from the tick body's hop data. */
    candidateProvider: (factionId: string) => ColonyEstablishCandidate[];
    params: ColonyEstablishParams;
  };
  /** The human seat, when one exists: gates PROPOSAL GENERATION for this faction per domain.
   *  Funding of committed work and manual orders is never gated. Omitted → no gating (harness). */
  player?: { factionId: string; automation: WorldPlayer["automation"] };
  /** Latched funded.construction per faction (0–1) — scales the funded pool. Missing
   *  faction or omitted map → 1 (ungated: engine tests, independents). */
  fundingByFaction?: ReadonlyMap<string, number>;
  /** The treasury position founding is priced against. Missing faction or omitted map → founding is
   *  UNPRICED for that faction: no charter is charged and no colony waits on one (the build-only
   *  engine/adapter path, and independents, which never colonise anyway). */
  treasuryByFaction?: ReadonlyMap<string, FactionFoundingPurse>;
}

/** One faction's money as the founding path reads it. `balance − pendingFounding` is the working
 *  balance: what is genuinely free once this cycle's already-committed founding is honoured. */
export interface FactionFoundingPurse {
  balance: number;
  /** Founding money committed since the last settlement and not yet charged. */
  pendingFounding: number;
  /** The faction's maintenance bill for one REFERENCE cycle — the charter's scale base, re-quoted
   *  every cycle. Reference-denominated because a charter is a one-off charge on an event, not a
   *  per-cycle rate: a settlement cadence change must not change what a colony costs. */
  maintenanceBill: number;
}

/** One colony's staging plan for a cycle: what it draws, what that costs, and how much of the cycle's
 *  manifest share it can satisfy (the ceiling on the work it may absorb). */
interface StagingDraw {
  lines: FoundingStockLine[];
  cost: number;
  /** Share of this cycle's manifest share that is satisfied — 1 when nothing holds the project back.
   *  Below 1 is money alone: what the source cannot spare is satisfied by the achievable-want rule. */
  achievableFraction: number;
  /** The source could not spare all of some good this cycle's share wanted. Reported rather than
   *  inferred from `achievableFraction`, which the achievable-want rule deliberately hides it from —
   *  it is the colony's endowment thinning, not its work being gated. */
  materialsShort: boolean;
}

/**
 * What an in-flight colony stages THIS cycle, and how much of the cycle's manifest share that covers.
 *
 * The manifest is sized on the COLONY's own basket — `FOUNDING_STOCK_COVER` cycles of
 * `consumptionRate` at the seed population, so it is mostly food and water at a small seed and only
 * a trace of anything an engineer would want, with no per-good list deciding what matters.
 * Deliberately not a share of the good's pricing anchor: that anchor floors at `MIN_DEMAND`, which at
 * a 2-pop seed flattens nearly every good to one figure and erases the basket's shape. It is drawn in
 * slices rather than in one raid at completion: `workShare` is the fraction of the whole establish the
 * ordinary absorption cap would build this cycle, so the materials arrive in step with the work. Per
 * good the draw is the least of what is still wanted, what the source can spare (`surplusDrawable`,
 * under the running per-(source, good) balance so two colonies drawing on one founder share a
 * shrinking pile), and what the faction's money buys through the valuation seam.
 *
 * `achievableFraction` is value-weighted across the cycle's share, and **a good the source cannot
 * spare this cycle counts as satisfied**: the colony lands with less of it, exactly as it does today,
 * rather than the project waiting forever on stock that is not coming. Without that rule the ceiling
 * would deadlock the median colony — a founder measurably spares only part of the want, so the share
 * could never reach 1 and the project would hold work below its cap for ever. What is left unsatisfied
 * is therefore money alone: a faction that cannot pay stages less and builds slower.
 *
 * Lives here rather than in the planner because only the processor has the source's market rows.
 */
function planStagingDraw(
  source: SystemBuildRow,
  project: WorldColonyEstablishProject,
  workShare: number,
  stockBalance: Map<string, number>,
  moneyLeft: number,
  cover: number,
  economyScale: number,
): StagingDraw {
  if (project.seedPop <= 0 || !(workShare > 0)) {
    return { lines: [], cost: 0, achievableFraction: 1, materialsShort: false };
  }

  const goods = toGoodMarketStates(source);
  // This cycle's slice, from the ONE share derivation the readout's quote also runs — so what a
  // colony is told the next cycle asks for is what it is actually charged for.
  const shareByGood = new Map(
    stagingShareLines(goods, project.stagedManifest, project.seedPop, workShare, cover)
      .map((l) => [l.goodId, l.quantity]),
  );

  const lines: FoundingStockLine[] = [];
  let budget = safeMoney(moneyLeft);
  let cost = 0;
  let targetValue = 0;
  let satisfiedValue = 0;
  let materialsShort = false;

  for (const good of goods) {
    const target = shareByGood.get(good.goodId);
    if (target === undefined) continue; // the seed does not want it, or wants no more of it

    // Unit price through the one valuation seam, so a staging debit and the charter's material
    // projection can never read two different numbers for the same good.
    const unitValue = foundingGoodsValue([{ goodId: good.goodId, quantity: 1 }], economyScale);
    targetValue += target * unitValue;

    const key = `${source.systemId}|${good.goodId}`;
    // Bounded by the row's LIVE stock as well as by the export rule, because this plan is written
    // straight into the project's ledger and that ledger is what the colony is credited on delivery.
    // A plan promising more than the row physically holds would record goods that never left the
    // founder; `applyFoundingStagingDraws` refuses such a draw outright rather than shorten it, so
    // overshooting here fails the tick. Bounding keeps the ledger equal to what is actually debited.
    const remaining = stockBalance.get(key)
      ?? Math.min(
        surplusDrawable(good.stock, good.donorReserve, good.demand, good.production ?? 0, good.productionSuppressed),
        Math.max(0, good.stock),
      );
    // An unreadable headroom spares nothing rather than poisoning the ledger: staged quantities are
    // world state, and `JSON.stringify` turns a NaN into null.
    const headroom = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    const sparable = Math.min(target, headroom);
    if (sparable < target) materialsShort = true;
    // The achievable-want rule: what the source cannot spare is satisfied by never being wanted again.
    satisfiedValue += (target - sparable) * unitValue;
    if (!(sparable > 0)) continue;

    const affordable = unitValue > 0 ? budget / unitValue : sparable;
    const quantity = Math.min(sparable, affordable);
    if (!(quantity > 0)) continue;
    const lineCost = quantity * unitValue;
    budget -= lineCost;
    cost += lineCost;
    satisfiedValue += lineCost;
    stockBalance.set(key, headroom - quantity);
    lines.push({ goodId: good.goodId, quantity });
  }

  // Nothing left to want this cycle is fully achievable, not fully stalled.
  const achievableFraction = targetValue > 0 ? clamp(satisfiedValue / targetValue, 0, 1) : 1;
  return { lines, cost, achievableFraction, materialsShort };
}

/** One priced colony's resolved plan for a cycle: what it stages, what that costs, the work ceiling
 *  the materials buy it, and the two ways the plan came up short. */
interface ColonyStagingPlan {
  lines: FoundingStockLine[];
  cost: number;
  plannedWork: number;
  /** The absorption cap this colony may actually use, `cap × achievableFraction`. */
  ceiling: number;
  /** The treasury could not buy the whole of this cycle's share. */
  fundsShort: boolean;
  /** The source could not spare the whole of it. Never lowers `ceiling` — the achievable-want rule. */
  materialsShort: boolean;
}

/**
 * What held one colony's work below the absorption cap this cycle, for the calibration record only —
 * the founding path refusing (`charter`, `funds`), the ordinary build queue never reaching the
 * project (`pool`), or nothing at all.
 *
 * The order is the binding order: an unpaid charter absorbs nothing whatever else is true, a ceiling
 * money held at zero comes next, and only then can a shortfall be blamed on the queue. A colony with
 * no plan — written off, or its source gone — buys nothing more and runs on work alone, so the queue
 * is the only thing left that can hold it up.
 *
 * The queue's test is against what the cycle COULD have absorbed (its planned work, under whatever
 * ceiling the materials bought), not against zero. Front-first funding runs out mid-project: the one
 * colony the pool reached partway reads as absorbing something, and testing for zero would file
 * exactly that marginal project — the "the pool got smaller" case this record exists to isolate — as
 * ungated.
 */
function colonyWorkGate(
  p: WorldColonyEstablishProject,
  plan: ColonyStagingPlan | undefined,
  absorbedWork: number,
  cap: number,
): FoundingStallEvent["gate"] {
  if (!p.charterPaid) return "charter";
  // A project with no plan was never given one, so its allowance is the ordinary cap against the
  // work it had left when the cycle opened (`workDone` already carries this cycle's absorption).
  const plannedWork =
    plan?.plannedWork ?? Math.min(cap, Math.max(0, p.workTotal - (p.workDone - absorbedWork)));
  if (plannedWork <= 0) return null;
  const ceiling = plan?.ceiling ?? cap;
  if (!(ceiling > 0)) return "funds";
  if (absorbedWork < Math.min(ceiling, plannedWork) - 1e-9) return "pool";
  return (plan?.fundsShort ?? false) ? "funds" : null;
}

/** Fold this cycle's staged lines into a project's ledger, summing per good. */
function mergeStaged(
  ledger: ReadonlyArray<FoundingStockLine>,
  added: ReadonlyArray<FoundingStockLine>,
): FoundingStockLine[] {
  const merged: FoundingStockLine[] = ledger.map((l) => ({ ...l }));
  for (const line of added) {
    const existing = merged.find((l) => l.goodId === line.goodId);
    if (existing) existing.quantity += line.quantity;
    else merged.push({ ...line });
  }
  return merged;
}

/** Build the engine's per-system build state: capacity + per-good market state (shared derivation). */
function toBuildState(row: SystemBuildRow): BuildSystemState {
  return {
    systemId: row.systemId,
    factionId: row.factionId,
    control: row.control,
    population: row.population,
    buildings: row.buildings,
    depositCounts: row.depositCounts,
    peopleLand: row.peopleLand,
    goods: toGoodMarketStates(row),
  };
}

/**
 * Pure processor body. Cycle resolution (mirrors directed-logistics): on the
 * boundary tick (`tick % interval === 0`) every faction is planned at once via
 * `cycleStartShard`; every other tick is a no-op.
 *
 * Construction is committed and throughput-paced: each due faction's auto queue policy
 * (`planFactionProposals`) proposes whole-level bundles toward its ceilings (subtracting the
 * levels already in flight); `orderProposals` ranks them by value (housing leads, then descending
 * bundle-ROI) and each is expanded gate-first into project rows; the faction's per-cycle throughput
 * pool funds the front-first queue (`fundQueue`, in-flight first) at a per-build absorption cap, and
 * only projects whose work COMPLETES land — applied as whole-integer building-count increments. The
 * open-project set is persisted each cycle (funded, plus new commitments, minus what landed). Removal
 * of levels stays whole-level decay's job — this only adds.
 *
 * Colonisation is the second consumer of the same decision → gate → pace pipeline: each faction's
 * controlled candidates are scored (`planFactionColonyProposals`, via colonyValue), interleaved with build
 * bundles by ROI (`orderProposals`), and expanded into colony-establish projects. There is no instant
 * develop flip — a `colony_establish` accrues work over cycles like any build and, on COMPLETION, develops
 * its target (seed transfer + bundled housing via `applyDevelopments`). Only funded colony proposals
 * persist as in-flight projects, so the open queue is bounded without a per-cycle develop cap.
 */
export async function runDirectedBuildProcessor(
  world: DirectedBuildWorld,
  ctx: Pick<TickContext, "tick">,
  params: DirectedBuildProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = cycleStartShard(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

  // Per-cycle incomes are reference-denominated; scale all three together so wall-clock build time,
  // parallel-front count (pool ÷ cap), and the floor's relative strength are interval-invariant. Work
  // costs and ceilings are stocks — never scaled.
  const catchUp = catchUpFactor(params.interval);
  const cap = params.construction.cap * catchUp;

  // ── Claim phase (control tier): every due faction proposes its best in-reach claim; conflicts
  // resolve deterministically (score, seeded-RNG ties); winners are written as ownership assignments.
  // Newly claimed systems are `controlled` (not developed), so the build phase ignores them this cycle. ──
  if (params.claim) {
    const proposals: ClaimProposal[] = [];
    for (const key of dueKeys) {
      if (key === null) continue;
      proposals.push(...proposeFactionClaims(key, params.claim.reachProvider(key), params.claim.params));
    }
    const resolved: SystemClaim[] = resolveClaims(proposals, params.claim.rng);
    if (resolved.length > 0) await world.applyClaims(resolved);
  }

  const rows = await world.getSystemsForFactions(dueKeys);
  if (rows.length === 0) return {};
  const openProjects = await world.getConstructionProjects(dueKeys);
  // The lane-upgrade opportunity's substrate — every lane in the world, not just the due factions'.
  // Ownership (for `laneInvestor`) is resolved below from the due factions' own system rows: a lane a
  // due faction may invest in has both endpoints in that faction's own group, which `getSystemsForFactions`
  // already loaded.
  const lanes = await world.getLanes();
  // Universe-wide development reference (galaxy's biggest natural potential) — the same value the
  // dev-map reads, so the speculative nudge scores each system's development consistently.
  const developmentRefs = await world.getDevelopmentRefs();

  // Group rows + open projects by faction; plan and fund each faction independently.
  const byFaction = new Map<string | null, SystemBuildRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }
  const openByFaction = new Map<string | null, WorldConstructionProject[]>();
  for (const p of openProjects) {
    const list = openByFaction.get(p.factionId) ?? [];
    list.push(p);
    openByFaction.set(p.factionId, list);
  }

  // Full rows by id — current building counts turn a landed whole-level increment into an absolute
  // write, and an in-flight colony reads its SOURCE's markets to size each cycle's staging draw.
  const rowBySystem = new Map(rows.map((r) => [r.systemId, r]));
  // `laneInvestor`'s ownership read, over this run's due-faction rows: a lane a due faction may
  // invest in has both endpoints owned by that faction, so both are present here. A system not in
  // this run's rows (owned by a faction not due this cycle, or unclaimed) reads as unclaimed —
  // `laneInvestor` returns null for it either way, since it can never match the faction under test.
  const laneOwnerOf = (systemId: string): LaneEndpointOwner => {
    const row = rowBySystem.get(systemId);
    return { factionId: row?.factionId ?? null, control: row?.control ?? "unclaimed" };
  };

  const landedBySystem = new Map<string, Map<string, number>>();
  const developments: SystemDevelopment[] = [];
  // Remaining drawable stock per (source system, good) across the whole cycle, so two colonies
  // founded from one system draw from the same shrinking pile rather than both reading its opening
  // stock — the same conservation `applyDevelopments` gives the seed population itself.
  const foundingStockBalance = new Map<string, number>();
  // This cycle's materials debits at the founding sources — applied to the markets by the tick body.
  const stagingDraws: FoundingStagingDraw[] = [];
  // Quantity already staged out of each (source system, good) THIS cycle. The source's row still
  // reads its opening stock — the debits land on the markets only after the whole cycle is planned —
  // so this running total is what makes each draw's founder cover its own reading rather than the
  // first draw's, and what separates two colonies drawing on one founder in one cycle.
  const founderDrawn = new Map<string, number>();
  // Per-source good state, derived once per cycle: the opening stock and donor floor every draw on
  // that founder is measured against.
  const founderStates = new Map<string, Map<string, GoodMarketState>>();
  const founderGoodState = (row: SystemBuildRow, goodId: string): GoodMarketState | undefined => {
    let byGood = founderStates.get(row.systemId);
    if (byGood === undefined) {
      byGood = new Map(toGoodMarketStates(row).map((g) => [g.goodId, g]));
      founderStates.set(row.systemId, byGood);
    }
    return byGood.get(goodId);
  };
  // Each cycle's staging draws, for the calibration harness only — the cost side of colonisation,
  // recorded as it happens because a slice is gone from every ledger the moment the tick returns.
  const foundingManifests: FoundingStagingEvent[] = [];
  // One record per priced colony per cycle, for the calibration harness only — what actually held
  // each in-flight founding back, which no post-tick reader can recover: the world stores how long a
  // project has been stalled, never why, and never that the queue simply did not reach it.
  const foundingStalls: FoundingStallEvent[] = [];
  const nextOpen: WorldConstructionProject[] = [];
  // Landed lane_upgrade levels this run, by laneKey — folded into `lanes` by the tick body via
  // `applyLaneLevelIncreases`. Stays empty on a cycle whose lane-upgrade proposals never fund far
  // enough to land a whole level, matching how the build/colony arms stay empty on a cycle that
  // lands neither.
  const laneLandings: LaneLevelIncrease[] = [];
  const workPerformedByFaction = new Map<string, number>();
  // Money committed to founding this cycle, per faction — the treasury's settlement input. Directed
  // build never writes `balance`; it commits against `balance − pendingFounding` and the settlement
  // applies what it committed.
  const foundingDebitsByFaction = new Map<string, number>();
  // Proposal-pressure counters advance for EVERY due faction's assessed markets — the construction
  // clock, distinct from the economy's squeeze clock — regardless of whether a proposal is emitted or
  // funded. Keyed by the market's composite id, the same convention the economy adapter writes by.
  const proposalPersistence: ProposalPersistenceUpdate[] = [];
  // Build blocked (alert bar): every system belonging to a due faction this run — the "visited" set
  // the world write clears against — and this run's best-ranked dropped opportunity per system that
  // had one. Advances alongside proposalPersistence above for the same reason: the assessment runs
  // for every due faction regardless of the automation switch, which gates PROPOSAL EMISSION only.
  const buildBlockedVisitedSystemIds: string[] = [];
  const blockedBuildUpdates: BuildBlockedUpdate[] = [];
  // Build opportunity (alert bar): the planner's best-ranked SCORED opportunity per system, banded
  // survival-first — see BuildOpportunityReport (lib/engine/directed-build.ts). Shares Build blocked's
  // visited set above (same planFactionProposals run, same "every due faction, regardless of
  // skipBuild" scope) — never gated by skipBuild, which only trims buildProposals below.
  const buildOpportunityUpdates: BuildOpportunityUpdate[] = [];
  // Colony opportunity (alert bar): every colony-establish CANDIDATE the colonisation planner
  // considered this run (a population distinct from Build blocked's — a candidate is CONTROLLED, not
  // yet developed) and this run's best-ranked colony-establish terms per candidate actually proposed.
  // The assessment below runs regardless of skipColonise, matching Build blocked/opportunity's own
  // "the switch gates proposal emission, not the clock" rule for its domain.
  const colonyOpportunityVisitedSystemIds: string[] = [];
  const colonyOpportunityUpdates: ColonyOpportunityUpdate[] = [];
  // Calibration instrumentation: new autonomic production-good levels committed THIS cycle, by good.
  // Counts proposal levels (before funding), not the final queue — so it measures the planner's
  // per-cycle output (the rate cap's target), not what the pool happened to afford. Housing, academies,
  // complexes, construction centres, and colony-establish are never good ids, so `GOODS[buildingType]`
  // excludes them without a separate kind check. Never fed into `TickBroadcastRaw`/SSE/world — the
  // calibration harness (`runWorldTick().instrumentation`) is its only reader.
  const buildCommitmentsByGood = new Map<string, number>();
  // Calibration instrumentation: proposals `strikeExplains` suppressed this cycle, resolved per
  // (system, good) pair and summed across every due faction's assessment — the planner's second exit
  // (the feedback-gap channel) narrows by however much this rate moves. Never fed into
  // `TickBroadcastRaw`/SSE/world — `runWorldTick().instrumentation` is its only reader.
  let strikeSuppressed = 0;
  let strikeEligible = 0;

  for (const [factionId, group] of byFaction) {
    // The faction's per-cycle pool: eligible heads + centre output over developed systems
    // (controlled/unclaimed are inert). Valuation reads the unscaled reference-cycle pool;
    // funding scales it by catchUp like every cycle income. The pool drains the queue; it
    // never enqueues.
    const poolRef = factionConstructionPool(
      group.map((r) => ({ control: r.control, population: r.population, buildings: r.buildings })),
      {
        throughputPerPop: params.construction.throughputPerPop,
        pointsPerLevel: params.construction.pointsPerLevel,
      },
    );
    // Money is fuel, not capacity: the funded fraction scales what share of the
    // physical pool's throughput runs this cycle. Valuation (centre pricing, ROI)
    // keeps reading the unscaled reference pool.
    const funded = factionId === null ? 1 : params.fundingByFaction?.get(factionId) ?? 1;
    const pool = poolRef.total * catchUp * funded;

    // The faction's money for founding: what is free once the founding already committed this
    // settlement period is honoured. Absent → this faction founds unpriced.
    const purse = factionId === null ? undefined : params.treasuryByFaction?.get(factionId);
    let workingBalance =
      purse === undefined ? 0 : foundingWorkingBalance(purse.balance, purse.pendingFounding);

    const existing = openByFaction.get(factionId) ?? [];
    // The human seat's per-domain switches: off = skip PROPOSAL GENERATION for this faction in that
    // domain. Committed funding always continues below; manual orders arrive via `existing`.
    const automation = params.player?.factionId === factionId ? params.player.automation : null;
    const skipBuild = automation !== null && !automation.build;
    const skipColonise = automation !== null && !automation.colonisation;
    const skipLanes = automation !== null && !automation.lanes;

    // Auto policy proposes new whole-level PROPOSALS toward the ceilings, aware of what is in flight;
    // value-order ranking (housing-leads, then descending bundle-ROI) reorders them before funding.
    // The assessment runs for every due faction so the proposal-pressure counter advances even when
    // build automation is off — the switch gates PROPOSAL EMISSION, not the construction clock.
    const buildStates = group.map(toBuildState);
    // Advance the proposal-pressure counter by this cycle's reference-time, so "two reference cycles
    // of persistence" is the same wall-clock latency at any construction cadence (not two cycles).
    const buildPlan = planFactionProposals(buildStates, params.routeCost, existing, developmentRefs, catchUp);
    for (const u of buildPlan.persistenceUpdates) {
      proposalPersistence.push({ id: `${u.systemId}|${u.goodId}`, proposalCycles: u.proposalCycles });
    }
    strikeSuppressed += buildPlan.strikeSuppressedProposals.suppressed;
    // The assessment above runs unconditionally (see the comment on `buildStates`), so every system
    // in `group` is visited whether or not build automation is on — the blocked-report write must not
    // be gated by `skipBuild` either, only the proposals a few lines below are.
    for (const s of group) buildBlockedVisitedSystemIds.push(s.systemId);
    for (const b of buildPlan.blockedBuilds) {
      blockedBuildUpdates.push({ systemId: b.systemId, reason: b.reason, droppedRoi: b.droppedRoi });
    }
    for (const o of buildPlan.buildOpportunities) {
      buildOpportunityUpdates.push({ systemId: o.systemId, score: o.score, goodId: o.goodId });
    }
    strikeEligible += buildPlan.strikeSuppressedProposals.eligible;
    const buildProposals = skipBuild ? [] : buildPlan.proposals;

    // Colony-establish proposals compete with builds on the same pool. Only faction-owned systems can
    // colonise (a null-faction group is independents — never); the develop param is omitted in build-only tests.
    // The assessment runs regardless of `skipColonise` — Colony opportunity (alert bar) needs the
    // planner's own terms even with colonisation automation off, mirroring build's own unconditional
    // assessment above — only `colonyProposals` (what feeds the funding queue) is gated by the switch.
    let allColonyProposals: ColonyProposal[] = [];
    if (params.develop && factionId !== null) {
      const developedStates = buildStates.filter((s) => isEconomicallyActive(s.control));
      const openColonies = existing.filter(
        (p): p is WorldColonyEstablishProject => p.kind === "colony_establish",
      );
      const candidates = params.develop.candidateProvider(factionId);
      allColonyProposals = planFactionColonyProposals(
        factionId, developedStates, candidates, openColonies, params.develop.params,
        purse === undefined ? undefined : { balance: workingBalance, maintenanceBill: purse.maintenanceBill },
      );
      // Colony opportunity persists the PRE-GATE assessment, not the funded list: a site worth
      // colonising stays on the alert bar while the treasury or settler supply can't yet cover it —
      // the money and settler gates shape only what gets founded. The assessment re-runs inside
      // `planFactionColonyProposals` too; it is a cheap pass over a faction's few controlled
      // candidates, priced against aggregates it computes once.
      const opportunities = assessColonyCandidates(
        factionId, developedStates, candidates, openColonies, params.develop.params,
      );
      for (const c of candidates) colonyOpportunityVisitedSystemIds.push(c.systemId);
      for (const p of opportunities) {
        colonyOpportunityUpdates.push({ systemId: p.systemId, value: p.value, work: p.work });
      }
    }
    const colonyProposals = skipColonise ? [] : allColonyProposals;

    // Lane-upgrade proposals: one per lane this faction invests in that turned away load last run
    // and has no upgrade already in flight. Independents (null faction) never invest in lanes.
    const laneProposals: LaneUpgradeProposal[] =
      factionId !== null && !skipLanes
        ? planLaneUpgradeProposals(factionId, lanes, existing, laneOwnerOf)
        : [];

    // Development-scaled pool floor (§7.9): reserve a self-weaning minimum slice for each young developed
    // colony, so its valid-but-low-ROI first build isn't monopolised out of the front-first pool by the
    // homeworld's larger builds. Development does the discriminating — the most-developed systems reserve
    // nothing — so no colony flag is needed. Only developed systems host builds and reserve a floor.
    const floorBySystem = new Map<string, number>();
    for (const s of buildStates) {
      if (!isEconomicallyActive(s.control)) continue;
      const share = developmentFloorShare(
        systemDevelopment(s, developmentRefs), params.construction.floorBase * catchUp, params.construction.floorKnee,
      );
      if (share > 0) floorBySystem.set(s.systemId, share);
    }
    let reserved = 0;
    for (const v of floorBySystem.values()) reserved += v;

    let ordered = orderProposals([...buildProposals, ...colonyProposals, ...laneProposals]);

    // At most one centre proposal per cycle, priced off the backlog frontier; it re-enters the
    // ROI ordering as a normal proposal (independent systems — null faction — never build centres).
    // A centre is a build-domain proposal, so it is gated by the same switch as ordinary builds.
    if (factionId !== null && !skipBuild) {
      const centre = planCentreProposal(factionId, ordered, existing, buildStates, poolRef.total, {
        pointsPerLevel: params.construction.pointsPerLevel,
        paybackHorizon: params.construction.paybackHorizon,
        backlogWindow: params.construction.backlogWindow,
      });
      if (centre) ordered = orderProposals([...ordered, centre]);
    }

    // Expand each proposal into whole-level project rows: a build bundle's `items` are already gate-first
    // (complex → academies → production); a colony is a single colony-establish project whose workTotal is
    // its establishWork. fundQueue never sees the ROI — the ordering is done.
    const newProjects: WorldConstructionProject[] = [];
    for (const p of ordered) {
      if (p.kind === "build") {
        for (const item of p.items) {
          newProjects.push({
            kind: "build",
            id: params.construction.mintId(),
            origin: "auto",
            factionId: p.factionId,
            systemId: p.systemId,
            buildingType: item.buildingType,
            levels: item.levels,
            workTotal: item.levels * workCostPerLevel(item.buildingType),
            workDone: 0,
          });
          if (GOODS[item.buildingType]) {
            buildCommitmentsByGood.set(
              item.buildingType,
              (buildCommitmentsByGood.get(item.buildingType) ?? 0) + item.levels,
            );
          }
        }
      } else if (p.kind === "lane_upgrade") {
        newProjects.push({
          kind: "lane_upgrade",
          id: params.construction.mintId(),
          origin: "auto",
          factionId: p.factionId,
          laneKey: p.laneKey,
          levels: p.levels,
          workTotal: p.levels * LANES.UPGRADE_WORK_PER_LEVEL,
          workDone: 0,
        });
      } else {
        newProjects.push({
          kind: "colony_establish",
          id: params.construction.mintId(),
          origin: "auto",
          factionId: p.factionId,
          systemId: p.systemId,
          sourceSystemId: p.sourceSystemId,
          seedPop: p.seedPop,
          housingLevels: p.housingLevels,
          workTotal: p.work,
          workDone: 0,
          stagedManifest: [],
          charterPaid: false,
          stalledCycles: 0,
        });
      }
    }

    const queue = [...orderOpenProjects(existing), ...newProjects];

    // ── Charter phase: committing to a colony and paying for it are ONE step ──
    // Every colony in the queue that has not paid its charter tries to, in queue order, against the
    // running working balance. The fee is re-quoted from the CURRENT maintenance bill, not from the
    // quote at proposal, so a faction that shrank between proposing and paying pays what it is worth
    // now. A colony that cannot pay stays unpaid and simply waits — it absorbs no work and stages
    // nothing until the money is there. Nothing here writes `balance`; the debit is committed to the
    // treasury's settlement, which is the single writer.
    const charterParams = params.develop?.params;
    let charterDebits = 0;
    const charged: WorldConstructionProject[] =
      purse === undefined || charterParams === undefined || factionId === null
        ? queue
        : queue.map((p) => {
            if (p.kind !== "colony_establish" || p.charterPaid) return p;
            const fee = charterFee(purse.maintenanceBill, {
              mult: charterParams.charterMult,
              min: charterParams.charterMin,
            });
            if (fee > workingBalance) return p; // no debt: a purchase that cannot be paid does not happen
            workingBalance -= fee;
            charterDebits += fee;
            return { ...p, charterPaid: true };
          });
    if (charterDebits > 0 && factionId !== null) {
      foundingDebitsByFaction.set(factionId, (foundingDebitsByFaction.get(factionId) ?? 0) + charterDebits);
    }

    // ── Materials phase: what each paid colony can stage this cycle, and the work that buys ──
    // Materials gate work, not the other way round. Plans are drawn in queue order against the same
    // working balance the charters just spent from, so two colonies can never commit one faction's
    // money twice; a plan reserves what it might spend and the unspent remainder simply goes unused
    // this cycle. Founding is only staged where it is PRICED: a faction with no purse (the build-only
    // engine path, independents) founds exactly as it did before, with no charter and no materials.
    const priced = purse !== undefined && charterParams !== undefined && factionId !== null;
    const stagingPlans = new Map<string, ColonyStagingPlan>();
    if (priced) {
      for (const p of charged) {
        if (p.kind !== "colony_establish" || !p.charterPaid) continue;
        // A written-off project has stopped wanting its remainder: it runs on work alone from here,
        // stages nothing more, and so keeps its counter latched above the threshold by construction.
        if (p.stalledCycles >= COLONISATION.FOUNDING_STALL_COMPLETE_CYCLES) continue;
        // A source that is gone can never supply the rest of the manifest — the whole remaining want
        // is unachievable, so the project finishes on work alone with what is already in its ledger.
        const source = rowBySystem.get(p.sourceSystemId);
        if (source === undefined) continue;
        const plannedWork = Math.min(cap, Math.max(0, p.workTotal - p.workDone));
        const workShare = p.workTotal > 0 ? plannedWork / p.workTotal : 0;
        const draw = planStagingDraw(
          source, p, workShare, foundingStockBalance, workingBalance,
          charterParams.foundingStockCover, charterParams.economyScale,
        );
        workingBalance = safeMoney(workingBalance - draw.cost);
        stagingPlans.set(p.id, {
          lines: draw.lines, cost: draw.cost, plannedWork, ceiling: cap * draw.achievableFraction,
          // Money is all that can leave the share unsatisfied, so a fraction below 1 is the treasury
          // failing to buy this cycle's slice — the one materials-side reason that gates work. The
          // tolerance is not cosmetic: a fully-bought share sums its value in a different order from
          // the target it is measured against, so an exact test would report float dust as a stall.
          fundsShort: draw.achievableFraction < 1 - 1e-9,
          materialsShort: draw.materialsShort,
        });
      }
    }
    // The seam through which what the queue cannot know — whether a colony's materials can be bought
    // this cycle — lowers one project's ceiling. Builds and unpriced foundings read the scalar cap.
    const capFor = (p: WorldConstructionProject): number => {
      if (!priced || p.kind !== "colony_establish") return cap;
      if (!p.charterPaid) return 0; // absorbs no work until the charter is bought
      return stagingPlans.get(p.id)?.ceiling ?? cap;
    };

    // Fund front-first (in-flight work finishes before new commitments, then fresh player orders,
    // then this cycle's new autonomic proposals), with the development-scaled colony floor reserved
    // ahead of the ROI order; land completed levels.
    const workBefore = new Map(charged.map((p) => [p.id, p.workDone]));
    const { projects: fundedOpen, landed, absorbed } = fundQueueWithFloor(
      charged, pool, cap, reserved,
      (p) => p.kind === "build" && (floorBySystem.get(p.systemId) ?? 0) > 0,
      capFor,
    );
    if (factionId !== null && absorbed > 0) workPerformedByFaction.set(factionId, absorbed);

    /**
     * Stage the manifest share matching the work a colony actually absorbed — recovered by diffing
     * `workDone`, so nothing is staged for work the pool did not fund. The staged goods leave the
     * source's markets and are paid for as they go; any staging resets the stall counter.
     *
     * A cycle that stages nothing advances that counter toward the write-off ONLY where the
     * materials are what held the project back. A ceiling above zero means materials would have let
     * work through, so absorbing none of it is the construction pool's doing — colonies reserve no
     * floor and can be out-ROI'd indefinitely — and a queue that never reached a project must not
     * write off its manifest for a reason that has nothing to do with what it can buy.
     */
    const stageOnto = (p: WorldConstructionProject): WorldConstructionProject => {
      if (!priced || p.kind !== "colony_establish") return p;
      const plan = stagingPlans.get(p.id);
      const absorbedWork = p.workDone - (workBefore.get(p.id) ?? p.workDone);
      // Prorate against the work the plan could ACTUALLY have funded — `min(ceiling, plannedWork)`,
      // the same expression the gate record measures against. The plan's lines were already cut to
      // what the money bought, so dividing by the un-ceilinged `plannedWork` would apply that same
      // affordability fraction a second time: a part-funded cycle would stage (and be charged) f² of
      // its share while doing f of the work, with nothing on any path reporting the gap.
      const fundable = plan === undefined ? 0 : Math.min(plan.ceiling, plan.plannedWork);
      const share =
        p.charterPaid && plan !== undefined && fundable > 0
          ? clamp(absorbedWork / fundable, 0, 1)
          : 0;
      const staged = (p.charterPaid ? plan?.lines ?? [] : [])
        .map((l) => ({ goodId: l.goodId, quantity: l.quantity * share }))
        .filter((l) => l.quantity > 0);
      const starvedOfPool =
        plan !== undefined && plan.plannedWork > 0 && plan.ceiling > 0 && absorbedWork <= 0;
      const stalled = p.charterPaid && staged.length === 0 && !starvedOfPool;
      foundingStalls.push({
        systemId: p.systemId,
        sourceSystemId: p.sourceSystemId,
        gate: colonyWorkGate(p, plan, absorbedWork, cap),
        materialsShort: p.charterPaid && (plan?.materialsShort ?? false),
        stalled,
      });
      if (!p.charterPaid) return p;
      if (staged.length === 0) return stalled ? { ...p, stalledCycles: p.stalledCycles + 1 } : p;
      const source = rowBySystem.get(p.sourceSystemId);
      let tonnage = 0;
      // The founder's own remaining cover on the good this draw binds hardest: post-draw stock over
      // that good's donor floor, minimum across the goods it moved. A good the founder has no use
      // for has no floor to be drawn under, so it is skipped rather than counted as a cover of 0.
      let binding = Infinity;
      for (const line of staged) {
        stagingDraws.push({ sourceSystemId: p.sourceSystemId, goodId: line.goodId, quantity: line.quantity });
        tonnage += line.quantity;
        const key = `${p.sourceSystemId}|${line.goodId}`;
        const drawn = (founderDrawn.get(key) ?? 0) + line.quantity;
        founderDrawn.set(key, drawn);
        const good = source === undefined ? undefined : founderGoodState(source, line.goodId);
        if (good === undefined || !(good.donorReserve > 0)) continue;
        binding = Math.min(binding, (good.stock - drawn) / good.donorReserve);
      }
      const spent = (plan?.cost ?? 0) * share;
      if (spent > 0 && factionId !== null) {
        foundingDebitsByFaction.set(factionId, (foundingDebitsByFaction.get(factionId) ?? 0) + spent);
      }
      foundingManifests.push({
        systemId: p.systemId,
        sourceSystemId: p.sourceSystemId,
        tonnage,
        goodIds: staged.map((l) => l.goodId),
        moneyCost: spent,
        founderCover: Number.isFinite(binding) ? binding : undefined,
      });
      return { ...p, stagedManifest: mergeStaged(p.stagedManifest, staged), stalledCycles: 0 };
    };

    for (const funded of fundedOpen) {
      const p = stageOnto(funded);
      // Persist-if-funded applies to AUTONOMIC colonies and centres only — they are re-emitted and
      // re-priced next cycle, so a workless row is dropped to keep the queue live. A player order is
      // a standing commitment with no re-emitter: it always persists until funded or cancelled. A
      // colony whose charter is PAID is a standing commitment too: dropping it would delete a project
      // the faction has already bought, and next cycle's re-emission would charge the charter again.
      if (p.origin !== "player") {
        if (p.kind === "colony_establish" && !p.charterPaid && p.workDone <= 0) continue;
        if (p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE && p.workDone <= 0) continue;
      }
      nextOpen.push(p);
    }
    for (const completed of landed) {
      const l = stageOnto(completed);
      if (l.kind === "build") {
        const byType = landedBySystem.get(l.systemId) ?? new Map<string, number>();
        byType.set(l.buildingType, (byType.get(l.buildingType) ?? 0) + l.levels);
        landedBySystem.set(l.systemId, byType);
      } else if (l.kind === "colony_establish") {
        // A completed colony-establish → develop the system: seed transfer + bundled housing + the
        // ledger it staged over the whole establish (all applied in tick.ts). Nothing is drawn from
        // the founder here — every line was debited on the cycle it was staged.
        developments.push({
          systemId: l.systemId, sourceSystemId: l.sourceSystemId, seedPop: l.seedPop, housingLevels: l.housingLevels,
          stockManifest: l.stagedManifest,
        });
      } else {
        // A completed (or level-boundary-split) lane_upgrade → credit whole levels onto the lane row.
        laneLandings.push({ key: l.laneKey, levels: l.levels });
      }
    }
  }

  // Debit this cycle's staged materials at their sources — the goods are now in-transit inventory in
  // the projects' ledgers, in no market row until their colony opens.
  if (stagingDraws.length > 0) await world.applyFoundingStagingDraws(stagingDraws);

  // Credit landed lane_upgrade levels onto their lanes.
  if (laneLandings.length > 0) await world.applyLaneLevelIncreases(laneLandings);

  // Apply completed colony establishments (develop + conserved seed + bundled housing).
  if (developments.length > 0) await world.applyDevelopments(developments);

  // Emit absolute new counts = current + landed whole levels (integer).
  const updates: BuildBuildingUpdate[] = [];
  for (const [systemId, byType] of landedBySystem) {
    const current = rowBySystem.get(systemId)?.buildings;
    for (const [buildingType, levels] of byType) {
      if (levels <= 0) continue;
      const cur = current?.[buildingType] ?? 0;
      updates.push({ systemId, buildingType, count: cur + levels });
    }
  }
  if (updates.length > 0) await world.applyBuildingIncreases(updates);

  // Persist the due factions' open set (funded existing + new commitments, minus what landed) —
  // always, so a project that just landed is removed from the queue.
  await world.applyConstructionUpdates(dueKeys, nextOpen);

  // Persist the construction proposal-pressure counters last — independent of ROI/funding outcome.
  if (proposalPersistence.length > 0) await world.applyProposalPersistenceUpdates(proposalPersistence);

  // Persist Build blocked — every due faction's assessment ran above regardless of automation, so
  // this write is unconditional too (see the comment where the two arrays are populated).
  if (buildBlockedVisitedSystemIds.length > 0) {
    await world.applyBuildBlockedUpdates(buildBlockedVisitedSystemIds, blockedBuildUpdates);
  }

  // Persist Build opportunity — same visited set, same unconditional-of-automation reasoning.
  if (buildBlockedVisitedSystemIds.length > 0) {
    await world.applyBuildOpportunityUpdates(buildBlockedVisitedSystemIds, buildOpportunityUpdates);
  }

  // Persist Colony opportunity — the candidate-scoped visited set, also unconditional of skipColonise.
  if (colonyOpportunityVisitedSystemIds.length > 0) {
    await world.applyColonyOpportunityUpdates(colonyOpportunityVisitedSystemIds, colonyOpportunityUpdates);
  }

  return {
    workPerformedByFaction, foundingDebitsByFaction, buildCommitmentsByGood,
    foundingManifests, foundingStalls,
    strikeSuppressedProposals: { suppressed: strikeSuppressed, eligible: strikeEligible },
  };
}
