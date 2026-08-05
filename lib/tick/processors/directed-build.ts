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
import type { WorldConstructionProject, WorldColonyEstablishProject, WorldPlayer } from "@/lib/world/types";
import { toGoodMarketStates } from "@/lib/tick/processors/good-market-state";
import type {
  DirectedBuildWorld,
  SystemBuildRow,
  BuildBuildingUpdate,
  SystemClaim,
  SystemDevelopment,
  FoundingStockLine,
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
}

/**
 * Goods the founding system sends with a colony seed, and what it can actually spare.
 *
 * Sized on the COLONY's own basket — `consumptionRate` at the seed population, so the manifest is
 * mostly food and water at a small seed and only a trace of anything an engineer would want, with no
 * per-good list deciding what matters. The want per good is `FOUNDING_STOCK_COVER` cycles of that
 * raw rate: every good opens at the same cycles-of-supply of what the seed genuinely uses.
 * Deliberately not a share of the good's pricing anchor — that anchor floors at `MIN_DEMAND`, which at
 * a 2-pop seed flattens nearly every good to one figure and erases the basket's shape.
 *
 * Two caps make it honest. `surplusDrawable` is the source's own export rule, so provisioning a
 * colony can never draw a founder below the reserve it keeps for itself; and `balance` carries what
 * is left of each source across the whole cycle, so two colonies founded from one system draw from
 * the same shrinking pile instead of both reading the opening stock. A source holding none of a good
 * sends none of it.
 *
 * Lives here rather than in the planner because only the processor has the source's market rows; the
 * pure planner has no market read or write path.
 */
function planFoundingStock(
  source: SystemBuildRow,
  seedPop: number,
  balance: Map<string, number>,
): FoundingStockLine[] {
  if (seedPop <= 0) return [];
  const basis: CivilianDemandBasis = { population: seedPop, technicians: 0, engineers: 0 };
  const manifest: FoundingStockLine[] = [];
  for (const good of toGoodMarketStates(source)) {
    // The want line is the seed population's raw civilian rate — a colony that does not exist yet
    // has no industry and no strike to gate. Its CAP is the founder's `surplusDrawable` below,
    // which is use-figure denominated, so a founder whose own draw was overstated now parts with
    // more per colony. The two sides are deliberately denominated differently.
    const colonyDemandRate = consumptionRate(good.goodId, basis);
    if (colonyDemandRate <= 0) continue; // the seed does not consume it
    const want = COLONISATION.FOUNDING_STOCK_COVER * colonyDemandRate;
    const key = `${source.systemId}|${good.goodId}`;
    const remaining = balance.get(key)
      ?? surplusDrawable(good.stock, good.donorReserve, good.demand, good.production ?? 0, good.productionSuppressed);
    const quantity = Math.min(want, Math.max(0, remaining));
    if (!(quantity > 0)) continue;
    balance.set(key, remaining - quantity);
    manifest.push({ goodId: good.goodId, quantity });
  }
  return manifest;
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
  const nextOpen: WorldConstructionProject[] = [];
  const workPerformedByFaction = new Map<string, number>();
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

    // Fund front-first (in-flight work finishes before new commitments, then fresh player orders,
    // then this cycle's new autonomic proposals), with the development-scaled colony floor reserved
    // ahead of the ROI order; land completed levels.
    const { projects: fundedOpen, landed, absorbed } = fundQueueWithFloor(
      [...orderOpenProjects(existing), ...newProjects], pool, cap, reserved,
      (p) => p.kind === "build" && (floorBySystem.get(p.systemId) ?? 0) > 0,
    );
    if (factionId !== null && absorbed > 0) workPerformedByFaction.set(factionId, absorbed);
    for (const p of fundedOpen) {
      // Persist-if-funded applies to AUTONOMIC colonies and centres only — they are re-emitted and
      // re-priced next cycle, so a workless row is dropped to keep the queue live. A player order is
      // a standing commitment with no re-emitter: it always persists until funded or cancelled.
      if (p.origin !== "player") {
        if (p.kind === "colony_establish" && p.workDone <= 0) continue;
        if (p.kind === "build" && p.buildingType === CONSTRUCTION_CENTRE_TYPE && p.workDone <= 0) continue;
      }
      nextOpen.push(p);
    }
    for (const l of landed) {
      if (l.kind === "build") {
        const byType = landedBySystem.get(l.systemId) ?? new Map<string, number>();
        byType.set(l.buildingType, (byType.get(l.buildingType) ?? 0) + l.levels);
        landedBySystem.set(l.systemId, byType);
      } else {
        // A completed colony-establish → develop the system: seed transfer + bundled housing + the
        // founding stock its source can spare (all applied in tick.ts).
        const source = rowBySystem.get(l.sourceSystemId);
        developments.push({
          systemId: l.systemId, sourceSystemId: l.sourceSystemId, seedPop: l.seedPop, housingLevels: l.housingLevels,
          stockManifest: source ? planFoundingStock(source, l.seedPop, foundingStockBalance) : [],
        });
      }
    }
  }

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

  // What each founding cost its founder, for the calibration harness only. Read here because the
  // manifest lines are gone by the time `applyDevelopments` has folded them into stock.
  const foundingManifests = developments
    .filter((d) => d.stockManifest.length > 0)
    .map((d) => ({
      systemId: d.systemId,
      sourceSystemId: d.sourceSystemId,
      tonnage: d.stockManifest.reduce((sum, line) => sum + Math.max(0, line.quantity), 0),
      goodIds: d.stockManifest.map((line) => line.goodId),
    }));

  return { workPerformedByFaction, buildCommitmentsByGood, foundingManifests };
}
