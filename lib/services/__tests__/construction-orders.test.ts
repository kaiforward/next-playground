import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getWorld } from "@/lib/world/store";
import { orderBuild, orderColony, cancelOrder, setAutomation } from "@/lib/services/construction-orders";
import { seatWorld, controlledNeighbour, playerHome } from "./seat-world";
import { colonyEligibility } from "@/lib/services/colony-eligibility";
import { foundingCommitmentCost } from "@/lib/engine/founding-cost";
import { runWorldTick } from "@/lib/world/tick";
import { COLONISATION } from "@/lib/constants/colonisation";
import { COLONY_BLOCK_COPY } from "@/lib/types/colonisation";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type {
  World, WorldBuildProject, WorldColonyEstablishProject, WorldTreasurySettlement,
} from "@/lib/world/types";

/** One system's whole warehouse, by good — the figure a conservation check is taken on. */
const stockAtSystem = (world: World, systemId: string) =>
  new Map(world.markets.filter((m) => m.systemId === systemId).map((m) => [m.goodId, m.stock]));

/**
 * Put money in the player's purse. World-gen starts every treasury at zero and founding is priced,
 * so any fixture that expects a colony order to go through has to be solvent first.
 */
function fundPlayer(balance: number) {
  const w = getWorld();
  setWorld({
    ...w,
    treasuries: w.treasuries.map((t) =>
      t.factionId === w.player?.controlledFactionId ? { ...t, balance } : t,
    ),
  });
}

/** A settled cycle whose only figure of interest is the maintenance bill the charter is quoted off. */
function settlementWithBill(maintenanceBill: number): WorldTreasurySettlement {
  return {
    tick: 0,
    headsIncome: 0, productionIncome: 0, incomeBySystem: [],
    maintenanceBill, maintenanceByType: [],
    logisticsBill: 0, constructionBill: 0,
    paid: { maintenance: 0, logistics: 0, construction: 0 },
    foundingExpense: 0,
  };
}

describe("construction order services", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("orders housing at the player's homeworld and batches a second order into the same row", () => {
    const nextIdBefore = getWorld().nextId;
    const first = orderBuild({ systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // A freshly minted id from the world's shared counter, and the counter advanced by exactly one.
    expect(first.data.projectId).toBe(`construction-${nextIdBefore}`);
    expect(getWorld().nextId).toBe(nextIdBefore + 1);
    const firstRow = getWorld().constructionProjects.find((p) => p.id === first.data.projectId)!;
    // workTotal = levels × work-per-level (housing is 8/level) — never divided, never left at 0.
    expect(firstRow.kind === "build" && firstRow.workTotal).toBe(8);

    const second = orderBuild({ systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.projectId).toBe(first.data.projectId);
    expect(second.data.levels).toBe(2);
    expect(getWorld().nextId).toBe(nextIdBefore + 1); // batched — no second id minted
    const row = getWorld().constructionProjects.find((p) => p.id === first.data.projectId)!;
    expect(row.origin).toBe("player");
    expect(row.kind === "build" && row.levels).toBe(2);
    // workTotal accumulates: existing 8 + the new level's own 8, never subtracted or divided.
    expect(row.kind === "build" && row.workTotal).toBe(16);
  });

  it("never merges a repeat order into a row of a DIFFERENT origin, system, or building type", () => {
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    const decoyAuto: WorldBuildProject = {
      kind: "build", id: "decoy-auto", origin: "auto", factionId: pid,
      systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 5, workTotal: 40, workDone: 0,
    };
    const decoyType: WorldBuildProject = {
      kind: "build", id: "decoy-type", origin: "player", factionId: pid,
      systemId: playerHome().id, buildingType: "ore", levels: 5, workTotal: 60, workDone: 0,
    };
    const otherSystemId = w.systems.find((s) => s.id !== playerHome().id)!.id;
    const decoySystem: WorldBuildProject = {
      kind: "build", id: "decoy-sys", origin: "player", factionId: pid,
      systemId: otherSystemId, buildingType: HOUSING_TYPE, levels: 5, workTotal: 40, workDone: 0,
    };
    setWorld({ ...w, constructionProjects: [decoyAuto, decoyType, decoySystem] });

    const placed = orderBuild({ systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.data.levels).toBe(1); // a genuinely NEW row, not merged into any decoy's 5
    // A second order now DOES merge into the row just created — exercising the `p.id === existing.id
    // ? merged : p` map on a queue that also holds unrelated rows, so a mutant that replaces EVERY
    // row (not just the matching one) corrupts the decoys.
    const placed2 = orderBuild({ systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(placed2.ok).toBe(true);
    if (!placed2.ok) return;
    expect(placed2.data.projectId).toBe(placed.data.projectId);

    const after = getWorld().constructionProjects;
    expect(after).toHaveLength(4); // 3 decoys + 1 real (merged) row
    expect(after.find((p) => p.id === "decoy-auto")).toMatchObject({ levels: 5, buildingType: HOUSING_TYPE });
    expect(after.find((p) => p.id === "decoy-type")).toMatchObject({ levels: 5, buildingType: "ore" });
    expect(after.find((p) => p.id === "decoy-sys")).toMatchObject({ levels: 5, systemId: otherSystemId });
  });

  it("nets in-flight BUILD levels at this system from EVERY faction (the queued fold has no faction filter)", () => {
    const h = playerHome();
    setWorld({
      ...getWorld(),
      buildings: getWorld().buildings.filter((b) => !(b.systemId === h.id && b.buildingType === "ore")),
    });
    h.countOre = 10;
    const otherSystemId = getWorld().systems.find((s) => s.id !== h.id)!.id;
    const rivalHere: WorldBuildProject = {
      kind: "build", id: "rival-ore", origin: "auto", factionId: "rival-faction",
      systemId: h.id, buildingType: "ore", levels: 7, workTotal: 70, workDone: 0,
    };
    const sameFactionElsewhere: WorldBuildProject = {
      kind: "build", id: "elsewhere-ore", origin: "auto", factionId: getWorld().player!.controlledFactionId,
      systemId: otherSystemId, buildingType: "ore", levels: 100, workTotal: 100, workDone: 0,
    };
    const wrongKindHere: WorldColonyEstablishProject = {
      kind: "colony_establish", id: "colony-here", origin: "auto", factionId: "rival-faction",
      systemId: h.id, sourceSystemId: h.id, seedPop: 2, housingLevels: 1,
      workTotal: 10, workDone: 0, stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    setWorld({ ...getWorld(), constructionProjects: [rivalHere, sameFactionElsewhere, wrongKindHere] });

    // 10 slots − 7 committed (same system, same kind, ANY faction) = 3 remain; the other-system and
    // wrong-kind rows must not count.
    expect(orderBuild({ systemId: h.id, buildingType: "ore", levels: 4 }).ok).toBe(false);
    expect(orderBuild({ systemId: h.id, buildingType: "ore", levels: 3 }).ok).toBe(true);
  });

  it("hard-rejects a build beyond the physical ceiling", () => {
    // The generated homeworld has hundreds of habitable-space units of headroom, so a request
    // has to be well beyond the schema's own 100-level cap to hit the service's physical ceiling.
    const r = orderBuild({ systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 100_000 });
    expect(r.ok).toBe(false);
  });

  it("rejects a build with no free resource slots, with the exact reason string", () => {
    // Force the ore deposit exhausted regardless of what world-gen rolled here (mirrors the
    // manufactured-eligibility idiom the colony test below uses): zero the homeworld's ore slots,
    // then ask for one more ore extractor level.
    const h = playerHome();
    h.countOre = 0;
    const r = orderBuild({ systemId: h.id, buildingType: "ore", levels: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("No free resource slots for that building here.");
  });

  it("every write verb rejects when no world is loaded", () => {
    clearWorld();
    expect(orderBuild({ systemId: "x", buildingType: HOUSING_TYPE, levels: 1 })).toEqual({ ok: false, error: "No world loaded." });
    expect(orderColony({ systemId: "x" })).toEqual({ ok: false, error: "No world loaded." });
    expect(cancelOrder({ projectId: "x" })).toEqual({ ok: false, error: "No world loaded." });
    expect(setAutomation({ build: true, colonisation: true })).toEqual({ ok: false, error: "No world loaded." });
  });

  it("every write verb rejects when the world has no player seat", () => {
    clearWorld();
    setWorld(generateWorld({ systemCount: 40, seed: 7 })); // no playerFaction
    expect(orderBuild({ systemId: "x", buildingType: HOUSING_TYPE, levels: 1 })).toEqual({ ok: false, error: "This world has no player seat." });
    expect(orderColony({ systemId: "x" })).toEqual({ ok: false, error: "This world has no player seat." });
    expect(cancelOrder({ projectId: "x" })).toEqual({ ok: false, error: "This world has no player seat." });
    expect(setAutomation({ build: true, colonisation: true })).toEqual({ ok: false, error: "This world has no player seat." });
  });

  it("orderBuild reports the exact not-found and not-yours messages", () => {
    const r1 = orderBuild({ systemId: "no-such-system", buildingType: HOUSING_TYPE, levels: 1 });
    expect(r1).toEqual({ ok: false, error: "System no-such-system not found." });
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.control === "developed" && s.factionId !== w.player?.controlledFactionId,
    )!;
    const r2 = orderBuild({ systemId: foreign.id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(r2).toEqual({ ok: false, error: "You do not control this system." });
  });

  it("orderBuild rejects an owned system that is not yet developed, with the exact message", () => {
    const { target } = controlledNeighbour(50); // owned, "controlled" — not developed
    const r = orderBuild({ systemId: target.id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(r).toEqual({ ok: false, error: "Builds require a developed system." });
  });

  it("rejects an unknown building type with the exact message", () => {
    const r = orderBuild({ systemId: playerHome().id, buildingType: "not-a-real-building", levels: 1 });
    expect(r).toEqual({ ok: false, error: "Unknown building type: not-a-real-building" });
  });

  it("reports the exact not-enough-space message (distinct from the deposit-slot message)", () => {
    const h = playerHome();
    // Housing bills to people land alone (build rule separation), so it's peopleLand — not
    // industryLand — that blocks it on "no_space", not deposit slots.
    h.peopleLand = 0;
    const r = orderBuild({ systemId: h.id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(r).toEqual({ ok: false, error: "Not enough space: 0 more level(s) fit here." });
  });

  it("allows an order exactly at the maxLevels ceiling, not just strictly under it", () => {
    const h = playerHome();
    setWorld({
      ...getWorld(),
      buildings: getWorld().buildings.filter((b) => !(b.systemId === h.id && b.buildingType === "ore")),
    });
    h.countOre = 3;
    expect(orderBuild({ systemId: h.id, buildingType: "ore", levels: 3 }).ok).toBe(true);
  });

  it("allows ordering the schema's own max level count (100) for a tier-1+ factory — it bills no land, so there is no ceiling to hit", () => {
    // metals is tier-1 (bills no land: buildableUnits returns Infinity). If the null-ceiling guard
    // were dropped or inverted, a request at the schema's own maxLevels would wrongly reject on
    // "not enough space".
    const h = playerHome();
    const r = orderBuild({ systemId: h.id, buildingType: "metals", levels: 100 });
    expect(r.ok).toBe(true);
  });

  it("rejects builds at systems the player does not control", () => {
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.control === "developed" && s.factionId !== w.player?.controlledFactionId,
    )!;
    const r = orderBuild({ systemId: foreign.id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(r.ok).toBe(false);
  });

  it("cancels only player-originated projects", () => {
    const placed = orderBuild({ systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1 });
    if (!placed.ok) throw new Error("setup failed");

    // Seed an auto-originated row for the same faction directly into the world — cancelOrder must
    // refuse it (origin !== "player") and leave it in place, not just refuse a made-up id.
    const w = getWorld();
    if (!w.player) throw new Error("fixture: expected a player seat");
    const autoProject: WorldBuildProject = {
      kind: "build", id: "auto-1", origin: "auto", factionId: w.player.controlledFactionId,
      systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1, workTotal: 10, workDone: 0,
    };
    setWorld({ ...w, constructionProjects: [...w.constructionProjects, autoProject] });
    expect(cancelOrder({ projectId: "auto-1" }).ok).toBe(false);
    expect(getWorld().constructionProjects.some((p) => p.id === "auto-1")).toBe(true);

    expect(cancelOrder({ projectId: placed.data.projectId }).ok).toBe(true);
    expect(getWorld().constructionProjects.some((p) => p.id === placed.data.projectId)).toBe(false);
    // The cancellation removed exactly the target — the OTHER (refused-to-cancel) row is still here.
    expect(getWorld().constructionProjects.some((p) => p.id === "auto-1")).toBe(true);
    expect(cancelOrder({ projectId: "no-such-project" }).ok).toBe(false);
  });

  it("cancelOrder refuses a project belonging to a different faction, even with origin \"player\"", () => {
    const foreignPlayerRow: WorldBuildProject = {
      kind: "build", id: "foreign-player-row", origin: "player", factionId: "someone-else",
      systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1, workTotal: 8, workDone: 0,
    };
    setWorld({ ...getWorld(), constructionProjects: [foreignPlayerRow] });
    expect(cancelOrder({ projectId: "foreign-player-row" }).ok).toBe(false);
    expect(getWorld().constructionProjects.some((p) => p.id === "foreign-player-row")).toBe(true);
  });

  it("orders a colony at an eligible controlled system and rejects an ineligible one", () => {
    // Deterministically manufacture eligibility: take a controlled player system if the seed
    // produced one, else claim an unclaimed neighbour of the homeworld as controlled.
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    let target = w.systems.find((s) => s.factionId === pid && s.control === "controlled");
    if (!target) {
      const conn = w.connections.find((c) => c.fromId === playerHome().id || c.toId === playerHome().id)!;
      const otherId = conn.fromId === playerHome().id ? conn.toId : conn.fromId;
      target = w.systems.find((s) => s.id === otherId)!;
      target.factionId = pid;
      target.control = "controlled";
    }
    fundPlayer(1_000_000); // amply solvent — this test is about the physical gates, not the price
    const nextIdBefore = getWorld().nextId;
    const r = orderColony({ systemId: target.id });
    if (target.peopleLand >= 1) {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.projectId).toBe(`construction-${nextIdBefore}`);
      expect(getWorld().nextId).toBe(nextIdBefore + 1);
      const row = getWorld().constructionProjects.find((p) => p.kind === "colony_establish" && p.systemId === target.id)!;
      expect(row.origin).toBe("player");
      // A second order on the same system is "already forming".
      expect(orderColony({ systemId: target.id }).ok).toBe(false);
    } else {
      expect(r.ok).toBe(false); // below the habitable floor is a legitimate reject
    }
    // The developed homeworld is never colony-eligible, with the exact control-state message.
    expect(orderColony({ systemId: playerHome().id })).toEqual({
      ok: false, error: "Colonies are established at controlled, not-yet-colonised systems.",
    });
  });

  it("refuses a colony the treasury cannot commit to, at the mutation boundary", () => {
    // With colonisation automation off — the player's normal mode — the planner's affordability gate
    // never runs for the player's faction. If the price is only enforced in the read service the
    // order still lands, and the player is the one faction in the galaxy that founds for free: it
    // holds `already_forming` on the target for nothing and pushes the maintenance floor around.
    const { target } = controlledNeighbour(50);
    const pid = getWorld().player!.controlledFactionId;

    // The price this candidate is quoted at, taken from the shared eligibility service itself (the
    // same `charter` and `projectedBill` the UI displays) so the boundary below is the real one.
    fundPlayer(Number.MAX_SAFE_INTEGER);
    const quote = colonyEligibility(getWorld(), pid, target);
    expect(quote.eligible).toBe(true);
    if (!quote.eligible) return;
    const cost = foundingCommitmentCost(
      quote.charter, quote.projectedBill, COLONISATION.FOUNDING_GATE_HEADROOM,
    );
    expect(cost).toBeGreaterThan(0);
    expect(quote.charter).toBeGreaterThan(0);

    fundPlayer(cost - 1); // one credit short of the commitment, every physical gate still passing
    const refused = orderColony({ systemId: target.id });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBe(COLONY_BLOCK_COPY.insufficient_funds);
    expect(
      getWorld().constructionProjects.some((p) => p.kind === "colony_establish" && p.systemId === target.id),
    ).toBe(false);

    // Exactly affordable: the same order goes through, its charter bought at the click, and the row
    // opens owing its whole manifest.
    fundPlayer(cost);
    const placed = orderColony({ systemId: target.id });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const row = getWorld().constructionProjects.find(
      (p): p is WorldColonyEstablishProject =>
        p.kind === "colony_establish" && p.id === placed.data.projectId,
    )!;
    expect(row.charterPaid).toBe(true);
    expect(row.stagedManifest).toEqual([]);
    expect(row.stalledCycles).toBe(0);
  });

  it("commits the charter at the click, so a second colony is priced against what is genuinely left", () => {
    // Money for exactly one commitment and two eligible candidates: the first order accrues its
    // charter into pendingFounding immediately, so the second order's gate sees the reduced working
    // balance and refuses — closing the window where an unpaid charter let the same money commit
    // two colonies. Cancelling does not refund it: a charter is lost by design.
    const { target, home } = controlledNeighbour(50);
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    const secondConn = w.connections.find((c) => {
      if (c.fromId !== home.id && c.toId !== home.id) return false;
      const otherId = c.fromId === home.id ? c.toId : c.fromId;
      return otherId !== target.id;
    });
    if (!secondConn) throw new Error("fixture: expected the homeworld to have a second neighbour");
    const secondId = secondConn.fromId === home.id ? secondConn.toId : secondConn.fromId;
    const second = w.systems.find((s) => s.id === secondId)!;
    second.factionId = pid;
    second.control = "controlled";
    second.peopleLand = 50;

    fundPlayer(Number.MAX_SAFE_INTEGER);
    const quote = colonyEligibility(getWorld(), pid, target);
    expect(quote.eligible).toBe(true);
    if (!quote.eligible) return;
    const cost = foundingCommitmentCost(
      quote.charter, quote.projectedBill, COLONISATION.FOUNDING_GATE_HEADROOM,
    );
    expect(quote.charter).toBeGreaterThan(0);

    fundPlayer(cost); // exactly one commitment's worth
    expect(orderColony({ systemId: target.id }).ok).toBe(true);
    const treasury = () => getWorld().treasuries.find((t) => t.factionId === pid)!;
    expect(treasury().pendingFounding).toBeCloseTo(quote.charter, 9);

    const refused = orderColony({ systemId: second.id });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBe(COLONY_BLOCK_COPY.insufficient_funds);

    // The charter survives a cancel — the commitment was spent, not reserved.
    const project = getWorld().constructionProjects.find(
      (p) => p.kind === "colony_establish" && p.systemId === target.id,
    )!;
    expect(cancelOrder({ projectId: project.id }).ok).toBe(true);
    expect(treasury().pendingFounding).toBeCloseTo(quote.charter, 9);
  });

  it("quotes the charter as the spend multiple of the settled bill, and charges exactly that", async () => {
    // The charter is priced off how much faction there is to administer, so the quote has to move
    // with the last settlement's maintenance bill rather than resting on its floor — and the number
    // the player is shown has to be the number the tick's charter phase actually debits.
    const { target } = controlledNeighbour(50);
    const w = getWorld();
    if (!w.player) throw new Error("fixture: expected a player seat");
    const pid = w.player.controlledFactionId;
    const BILL = 10_000; // × the spend multiple, far clear of the floor
    setWorld({
      ...w,
      // Colonisation automation off, so the only colony bought is the one ordered below; every
      // construction band unfunded, so no work — and therefore no staged materials — joins the
      // charter in the same accumulator.
      player: { ...w.player, automation: { ...w.player.automation, colonisation: false } },
      treasuries: w.treasuries.map((t) => ({
        ...t,
        funded: { ...t.funded, construction: 0 },
        ...(t.factionId === pid
          ? { balance: 5_000_000, lastSettlement: settlementWithBill(BILL) }
          : {}),
      })),
    });

    const quote = colonyEligibility(getWorld(), pid, target);
    expect(quote.eligible).toBe(true);
    if (!quote.eligible) return;
    expect(quote.charter).toBeCloseTo(COLONISATION.CHARTER_FEE_SPEND_MULT * BILL, 6);
    expect(quote.charter).toBeGreaterThan(COLONISATION.CHARTER_FEE_MIN); // a real multiple, not the floor

    expect(orderColony({ systemId: target.id }).ok).toBe(true);

    // The shipped cadence, because that is the one the read service quotes against: it reads the
    // CYCLE_LENGTH constant, while the tick de-scales by whatever cadence it was handed. A
    // non-shipped cadence would compare the two prices at two different reference cycles.
    let world = getWorld();
    const cadence = { cycle: 24, construction: 24, logistics: 24 };
    for (let tick = 1; tick <= 24; tick++) world = (await runWorldTick(world, { cadence })).world;

    const row = world.constructionProjects.find(
      (p): p is WorldColonyEstablishProject =>
        p.kind === "colony_establish" && p.systemId === target.id,
    );
    expect(row?.charterPaid).toBe(true);
    // The charter is the whole founding expense of that cycle: an unfunded construction band means
    // no work was absorbed, so no materials were staged alongside it.
    const treasury = world.treasuries.find((t) => t.factionId === pid)!;
    expect(treasury.lastSettlement?.foundingExpense).toBeCloseTo(quote.charter, 6);
  });

  it("projects the material bill off the SEED SOURCE's own rows, and quotes a fresh treasury off the floor", () => {
    // A colony can only ever be provisioned from its own source, so the bill is that system's market
    // list — priced off the whole galaxy's it would be an order of magnitude out and refuse every
    // founding, and off the wrong system it would quote goods that were never on offer.
    const { target } = controlledNeighbour(50);
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    fundPlayer(Number.MAX_SAFE_INTEGER);

    const quote = colonyEligibility(getWorld(), pid, target);
    expect(quote.eligible).toBe(true);
    if (!quote.eligible) return;
    const sourceGoods = new Set(
      getWorld().markets.filter((m) => m.systemId === quote.sourceSystemId).map((m) => m.goodId),
    );
    const galaxyGoods = new Set(getWorld().markets.map((m) => m.goodId));
    expect(sourceGoods.size).toBeGreaterThan(0);

    // Deleting a good the SOURCE lists moves the bill; deleting the same good everywhere else does
    // not — the projection is that one system's list, not the galaxy's.
    const dropAt = (systemIds: (id: string) => boolean, goodId: string) =>
      setWorld({
        ...getWorld(),
        markets: getWorld().markets.filter((m) => !(systemIds(m.systemId) && m.goodId === goodId)),
      });
    const consumed = [...sourceGoods].find((g) => {
      const w2 = getWorld();
      dropAt((id) => id === quote.sourceSystemId, g);
      const after = colonyEligibility(getWorld(), pid, target);
      setWorld(w2);
      return after.eligible && after.projectedBill < quote.projectedBill;
    });
    expect(consumed).toBeDefined();
    if (consumed === undefined) return;
    expect(galaxyGoods.has(consumed)).toBe(true);

    dropAt((id) => id !== quote.sourceSystemId, consumed);
    const elsewhereGone = colonyEligibility(getWorld(), pid, target);
    expect(elsewhereGone.eligible).toBe(true);
    if (!elsewhereGone.eligible) return;
    expect(elsewhereGone.projectedBill).toBeCloseTo(quote.projectedBill, 9);
  });

  it("quotes a never-settled faction's charter off the floor rather than reading through a null settlement", () => {
    // World-gen starts every treasury unsettled, so this is the state the very first colony of a
    // game is priced in: there is no maintenance bill to scale the fee off yet, and the floor is
    // what the charter is FOR at that moment.
    const { target } = controlledNeighbour(50);
    const pid = getWorld().player!.controlledFactionId;
    fundPlayer(Number.MAX_SAFE_INTEGER);
    expect(getWorld().treasuries.find((t) => t.factionId === pid)?.lastSettlement ?? null).toBeNull();

    const quote = colonyEligibility(getWorld(), pid, target);
    expect(quote.eligible).toBe(true);
    if (!quote.eligible) return;
    expect(quote.charter).toBe(COLONISATION.CHARTER_FEE_MIN);
  });

  it("refuses a colony to a faction with no treasury at all", () => {
    // A working balance is `balance − pendingFounding`; with no treasury row there is no balance,
    // and reading one anyway would either throw or found the colony for free.
    const { target } = controlledNeighbour(50);
    const pid = getWorld().player!.controlledFactionId;
    setWorld({ ...getWorld(), treasuries: getWorld().treasuries.filter((t) => t.factionId !== pid) });

    const quote = colonyEligibility(getWorld(), pid, target);
    expect(quote.eligible).toBe(false);
    if (quote.eligible) return;
    expect(quote.reason).toBe("insufficient_funds");
  });

  it("returns a cancelled colony's staged goods to its founder, conserving total stock", () => {
    // The spec's conservation bar for cancellation: staged materials are real inventory, already out
    // of the founder's markets and paid for. Deleting the row without returning them destroys stock
    // the faction owns. Work and the charter stay forfeit — only the goods come home.
    // Manufacture an eligible controlled target next to the homeworld, with land well clear of the
    // habitable floor so nothing rejects on substrate, and a purse that covers the commitment.
    const { target } = controlledNeighbour(50);
    fundPlayer(1_000_000);

    const placed = orderColony({ systemId: target.id });
    if (!placed.ok) throw new Error("setup failed");
    const ordered = getWorld();
    const project = ordered.constructionProjects.find(
      (p): p is WorldColonyEstablishProject =>
        p.kind === "colony_establish" && p.id === placed.data.projectId,
    )!;
    const before = stockAtSystem(ordered, project.sourceSystemId);

    // Stage a cycle's materials exactly as the tick does: debit the founder's rows, append the same
    // quantities to the project's ledger.
    const staged = [...before.entries()]
      .filter(([, stock]) => stock > 0)
      .slice(0, 2)
      .map(([goodId, stock]) => ({ goodId, quantity: stock / 4 }));
    expect(staged).toHaveLength(2); // the fixture's founder really does hold stock to stage
    setWorld({
      ...ordered,
      markets: ordered.markets.map((m) => {
        if (m.systemId !== project.sourceSystemId) return m;
        const line = staged.find((l) => l.goodId === m.goodId);
        return line ? { ...m, stock: m.stock - line.quantity } : m;
      }),
      constructionProjects: ordered.constructionProjects.map((p) =>
        p.id === project.id ? { ...project, stagedManifest: staged } : p,
      ),
    });
    const mid = stockAtSystem(getWorld(), project.sourceSystemId);
    for (const line of staged) {
      expect(mid.get(line.goodId)!).toBeLessThan(before.get(line.goodId)!); // genuinely gone in flight
    }

    expect(cancelOrder({ projectId: project.id }).ok).toBe(true);

    const after = stockAtSystem(getWorld(), project.sourceSystemId);
    for (const [goodId, stock] of before) expect(after.get(goodId)).toBeCloseTo(stock, 9);
    expect(getWorld().constructionProjects.some((p) => p.id === project.id)).toBe(false);
  });

  it("credits a cancelled colony's goods to its own founder alone, and only the readable lines", () => {
    // Two hazards in one path: a line that cannot be read is world state waiting to become null on
    // the next save, and a credit written onto every row carrying that good would mint stock across
    // the galaxy for goods only one system ever parted with.
    const { target } = controlledNeighbour(50);
    fundPlayer(1_000_000);
    const placed = orderColony({ systemId: target.id });
    if (!placed.ok) throw new Error("setup failed");
    const ordered = getWorld();
    const project = ordered.constructionProjects.find(
      (p): p is WorldColonyEstablishProject =>
        p.kind === "colony_establish" && p.id === placed.data.projectId,
    )!;
    const goodId = [...stockAtSystem(ordered, project.sourceSystemId).entries()]
      .find(([, stock]) => stock > 0)![0];
    const elsewhere = ordered.markets.filter(
      (m) => m.goodId === goodId && m.systemId !== project.sourceSystemId,
    );
    expect(elsewhere.length).toBeGreaterThan(0); // other systems really do hold this good

    setWorld({
      ...ordered,
      constructionProjects: ordered.constructionProjects.map((p) =>
        p.id === project.id
          ? {
              ...project,
              stagedManifest: [
                { goodId, quantity: 40 },
                { goodId, quantity: Number.NaN },
                { goodId, quantity: 0 },
                { goodId, quantity: -10 },
              ],
            }
          : p,
      ),
    });
    const beforeSource = stockAtSystem(getWorld(), project.sourceSystemId).get(goodId)!;
    expect(cancelOrder({ projectId: project.id }).ok).toBe(true);

    // Exactly the readable line came home — the unreadable, the empty and the negative ones did not.
    expect(stockAtSystem(getWorld(), project.sourceSystemId).get(goodId)).toBeCloseTo(
      beforeSource + 40, 9,
    );
    for (const m of elsewhere) {
      const now = getWorld().markets.find(
        (x) => x.systemId === m.systemId && x.goodId === m.goodId,
      );
      expect(now?.stock).toBe(m.stock); // every other holder of the good is untouched
    }
  });

  it("leaves every market row alone when there is nothing readable to return", () => {
    const { target } = controlledNeighbour(50);
    fundPlayer(1_000_000);
    const placed = orderColony({ systemId: target.id });
    if (!placed.ok) throw new Error("setup failed");
    const ordered = getWorld();
    setWorld({
      ...ordered,
      constructionProjects: ordered.constructionProjects.map((p) =>
        p.id === placed.data.projectId && p.kind === "colony_establish"
          ? { ...p, stagedManifest: [{ goodId: "food", quantity: 0 }] }
          : p,
      ),
    });
    const markets = getWorld().markets;
    expect(cancelOrder({ projectId: placed.data.projectId }).ok).toBe(true);
    expect(getWorld().markets).toBe(markets); // the same array, not a rebuilt copy
  });

  it("leaves every market row alone when a build order is cancelled", () => {
    const placed = orderBuild({ systemId: playerHome().id, buildingType: HOUSING_TYPE, levels: 1 });
    if (!placed.ok) throw new Error("setup failed");
    const markets = getWorld().markets;
    expect(cancelOrder({ projectId: placed.data.projectId }).ok).toBe(true);
    expect(getWorld().markets).toBe(markets); // the same array, not a rebuilt copy
  });

  it("sets and reports automation on the player seat", () => {
    const r = setAutomation({ build: false, colonisation: true });
    expect(r.ok).toBe(true);
    expect(getWorld().player?.automation).toEqual({ build: false, colonisation: true });
  });
});
