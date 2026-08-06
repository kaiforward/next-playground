import type { TickContext, TickProcessorResult } from "../types";
import { cycleStartShard, catchUpFactor } from "@/lib/tick/shard";
import { planFactionProposals, planFactionColonyProposals, type BuildSystemState, type ColonyProposal, type ColonyEstablishCandidate, type ColonyEstablishParams } from "@/lib/engine/directed-build";
import { fundQueueWithFloor, developmentFloorShare, factionConstructionPool, orderProposals, orderOpenProjects } from "@/lib/engine/construction";
import { planCentreProposal } from "@/lib/engine/construction-centre";
import { CONSTRUCTION_CENTRE_TYPE } from "@/lib/constants/industry";
import { GOODS } from "@/lib/constants/goods";
import { systemDevelopment } from "@/lib/engine/development";
import { isEconomicallyActive } from "@/lib/engine/control";
import { workCostPerLevel } from "@/lib/constants/construction";
import { surplusDrawable, type RouteCost } from "@/lib/engine/directed-logistics";
import { consumptionRate, type CivilianDemandBasis } from "@/lib/engine/physical-economy";
import { COLONISATION } from "@/lib/constants/colonisation";
import { charterFee, foundingGoodsValue } from "@/lib/engine/founding-cost";
import { safeMoney } from "@/lib/engine/treasury";
import { clamp } from "@/lib/utils/math";
import type { WorldConstructionProject, WorldColonyEstablishProject, WorldPlayer } from "@/lib/world/types";
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
  /** Share of this cycle's manifest share that is satisfied — 1 when nothing holds the project back. */
  achievableFraction: number;
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
  economyScale: number,
): StagingDraw {
  if (project.seedPop <= 0 || !(workShare > 0)) return { lines: [], cost: 0, achievableFraction: 1 };

  const stagedSoFar = new Map<string, number>();
  for (const line of project.stagedManifest) {
    stagedSoFar.set(line.goodId, (stagedSoFar.get(line.goodId) ?? 0) + Math.max(0, line.quantity));
  }

  const basis: CivilianDemandBasis = { population: project.seedPop, technicians: 0, engineers: 0 };
  const lines: FoundingStockLine[] = [];
  let budget = safeMoney(moneyLeft);
  let cost = 0;
  let targetValue = 0;
  let satisfiedValue = 0;

  for (const good of toGoodMarketStates(source)) {
    const colonyDemandRate = consumptionRate(good.goodId, basis);
    if (colonyDemandRate <= 0) continue; // the seed does not consume it
    const want = COLONISATION.FOUNDING_STOCK_COVER * colonyDemandRate;
    const remainingWant = Math.max(0, want - (stagedSoFar.get(good.goodId) ?? 0));
    const target = Math.min(remainingWant, workShare * want);
    if (!(target > 0)) continue;

    // Unit price through the one valuation seam, so a staging debit and the charter's material
    // projection can never read two different numbers for the same good.
    const unitValue = foundingGoodsValue([{ goodId: good.goodId, quantity: 1 }], economyScale);
    targetValue += target * unitValue;

    const key = `${source.systemId}|${good.goodId}`;
    // Bounded by the row's LIVE stock as well as by the export rule, because this plan is written
    // straight into the project's ledger and that ledger is what the colony is credited on delivery.
    // The debit itself clamps to live stock (`applyFoundingStagingDraws`), so a plan promising more
    // than the row physically holds would record goods that never left the founder — and deliver
    // them anyway. Bounding here keeps the ledger equal to what was actually debited.
    const remaining = stockBalance.get(key)
      ?? Math.min(
        surplusDrawable(good.stock, good.donorReserve, good.demand, good.production ?? 0, good.productionSuppressed),
        Math.max(0, good.stock),
      );
    // An unreadable headroom spares nothing rather than poisoning the ledger: staged quantities are
    // world state, and `JSON.stringify` turns a NaN into null.
    const headroom = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
    const sparable = Math.min(target, headroom);
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
  return { lines, cost, achievableFraction };
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
    slotCap: row.slotCap,
    generalSpace: row.generalSpace,
    habitableSpace: row.habitableSpace,
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
  // write, and a landed colony reads its SOURCE's markets to size the founding endowment.
  const rowBySystem = new Map(rows.map((r) => [r.systemId, r]));

  const landedBySystem = new Map<string, Map<string, number>>();
  const developments: SystemDevelopment[] = [];
  // Remaining drawable stock per (source system, good) across the whole cycle, so two colonies
  // founded from one system draw from the same shrinking pile rather than both reading its opening
  // stock — the same conservation `applyDevelopments` gives the seed population itself.
  const foundingStockBalance = new Map<string, number>();
  // This cycle's materials debits at the founding sources — applied to the markets by the tick body.
  const stagingDraws: FoundingStagingDraw[] = [];
  const nextOpen: WorldConstructionProject[] = [];
  const workPerformedByFaction = new Map<string, number>();
  // Money committed to founding this cycle, per faction — the treasury's settlement input. Directed
  // build never writes `balance`; it commits against `balance − pendingFounding` and the settlement
  // applies what it committed.
  const foundingDebitsByFaction = new Map<string, number>();
  // Proposal-pressure counters advance for EVERY due faction's assessed markets — the construction
  // clock, distinct from the economy's squeeze clock — regardless of whether a proposal is emitted or
  // funded. Keyed by the market's composite id, the same convention the economy adapter writes by.
  const proposalPersistence: ProposalPersistenceUpdate[] = [];
  // Calibration instrumentation: new autonomic production-good levels committed THIS cycle, by good.
  // Counts proposal levels (before funding), not the final queue — so it measures the planner's
  // per-cycle output (the rate cap's target), not what the pool happened to afford. Housing, academies,
  // complexes, construction centres, and colony-establish are never good ids, so `GOODS[buildingType]`
  // excludes them without a separate kind check. Never fed into `TickBroadcastRaw`/SSE/world — the
  // calibration harness (`runWorldTick().instrumentation`) is its only reader.
  const buildCommitmentsByGood = new Map<string, number>();

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
    let workingBalance = purse === undefined ? 0 : safeMoney(safeMoney(purse.balance) - safeMoney(purse.pendingFounding));

    const existing = openByFaction.get(factionId) ?? [];
    // The human seat's per-domain switches: off = skip PROPOSAL GENERATION for this faction in that
    // domain. Committed funding always continues below; manual orders arrive via `existing`.
    const automation = params.player?.factionId === factionId ? params.player.automation : null;
    const skipBuild = automation !== null && !automation.build;
    const skipColonise = automation !== null && !automation.colonisation;

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
    const buildProposals = skipBuild ? [] : buildPlan.proposals;

    // Colony-establish proposals compete with builds on the same pool. Only faction-owned systems can
    // colonise (a null-faction group is independents — never); the develop param is omitted in build-only tests.
    let colonyProposals: ColonyProposal[] = [];
    if (params.develop && factionId !== null && !skipColonise) {
      const developedStates = buildStates.filter((s) => isEconomicallyActive(s.control));
      const openColonies = existing.filter(
        (p): p is WorldColonyEstablishProject => p.kind === "colony_establish",
      );
      colonyProposals = planFactionColonyProposals(
        factionId, developedStates, params.develop.candidateProvider(factionId), openColonies, params.develop.params,
        purse === undefined ? undefined : { balance: workingBalance, maintenanceBill: purse.maintenanceBill },
      );
    }

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

    let ordered = orderProposals([...buildProposals, ...colonyProposals]);

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
    const stagingPlans = new Map<
      string,
      { lines: FoundingStockLine[]; cost: number; plannedWork: number; ceiling: number }
    >();
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
          source, p, workShare, foundingStockBalance, workingBalance, charterParams.economyScale,
        );
        workingBalance = safeMoney(workingBalance - draw.cost);
        stagingPlans.set(p.id, {
          lines: draw.lines, cost: draw.cost, plannedWork, ceiling: cap * draw.achievableFraction,
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
      if (!priced || p.kind !== "colony_establish" || !p.charterPaid) return p;
      const plan = stagingPlans.get(p.id);
      const absorbedWork = p.workDone - (workBefore.get(p.id) ?? p.workDone);
      const share =
        plan !== undefined && plan.plannedWork > 0 ? clamp(absorbedWork / plan.plannedWork, 0, 1) : 0;
      const staged = (plan?.lines ?? [])
        .map((l) => ({ goodId: l.goodId, quantity: l.quantity * share }))
        .filter((l) => l.quantity > 0);
      if (staged.length === 0) {
        const starvedOfPool =
          plan !== undefined && plan.plannedWork > 0 && plan.ceiling > 0 && absorbedWork <= 0;
        return starvedOfPool ? p : { ...p, stalledCycles: p.stalledCycles + 1 };
      }
      for (const line of staged) {
        stagingDraws.push({ sourceSystemId: p.sourceSystemId, goodId: line.goodId, quantity: line.quantity });
      }
      const spent = (plan?.cost ?? 0) * share;
      if (spent > 0 && factionId !== null) {
        foundingDebitsByFaction.set(factionId, (foundingDebitsByFaction.get(factionId) ?? 0) + spent);
      }
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
      } else {
        // A completed colony-establish → develop the system: seed transfer + bundled housing + the
        // ledger it staged over the whole establish (all applied in tick.ts). Nothing is drawn from
        // the founder here — every line was debited on the cycle it was staged.
        developments.push({
          systemId: l.systemId, sourceSystemId: l.sourceSystemId, seedPop: l.seedPop, housingLevels: l.housingLevels,
          stockManifest: l.stagedManifest,
        });
      }
    }
  }

  // Debit this cycle's staged materials at their sources — the goods are now in-transit inventory in
  // the projects' ledgers, in no market row until their colony opens.
  if (stagingDraws.length > 0) await world.applyFoundingStagingDraws(stagingDraws);

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

  // What each founding cost its founder, for the calibration harness only — the whole staged ledger
  // the colony opens with, read here because the lines are gone by the time the tick body has
  // delivered them onto the colony's market rows.
  const foundingManifests = developments
    .filter((d) => d.stockManifest.length > 0)
    .map((d) => ({
      systemId: d.systemId,
      sourceSystemId: d.sourceSystemId,
      tonnage: d.stockManifest.reduce((sum, line) => sum + Math.max(0, line.quantity), 0),
      goodIds: d.stockManifest.map((line) => line.goodId),
    }));

  return { workPerformedByFaction, foundingDebitsByFaction, buildCommitmentsByGood, foundingManifests };
}
