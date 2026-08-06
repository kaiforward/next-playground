import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getWorld } from "@/lib/world/store";
import { orderBuild, orderColony, cancelOrder, setAutomation } from "@/lib/services/construction-orders";
import { colonyEligibility } from "@/lib/services/colony-eligibility";
import { foundingCommitmentCost } from "@/lib/engine/founding-cost";
import { COLONISATION } from "@/lib/constants/colonisation";
import { COLONY_BLOCK_COPY } from "@/lib/types/colonisation";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import type { World, WorldBuildProject, WorldColonyEstablishProject } from "@/lib/world/types";

/** A small authored world: the player faction owns a developed homeworld. */
function seatWorld() {
  return generateWorld({
    systemCount: 60, seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}
const home = () => {
  const w = getWorld();
  const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
  return w.systems.find((s) => s.id === f.homeworldId)!;
};

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

/** A controlled, amply-landed player system next to the homeworld — eligibility manufactured, not rolled. */
function controlledNeighbour(habitableSpace: number) {
  const w = getWorld();
  if (!w.player) throw new Error("fixture: expected a player seat");
  const conn = w.connections.find((c) => c.fromId === home().id || c.toId === home().id)!;
  const otherId = conn.fromId === home().id ? conn.toId : conn.fromId;
  const target = w.systems.find((s) => s.id === otherId)!;
  target.factionId = w.player.controlledFactionId;
  target.control = "controlled";
  target.habitableSpace = habitableSpace;
  return target;
}

describe("construction order services", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("orders housing at the player's homeworld and batches a second order into the same row", () => {
    const first = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.projectId).toBe(first.data.projectId);
    expect(second.data.levels).toBe(2);
    const row = getWorld().constructionProjects.find((p) => p.id === first.data.projectId)!;
    expect(row.origin).toBe("player");
    expect(row.kind === "build" && row.levels).toBe(2);
  });

  it("hard-rejects a build beyond the physical ceiling", () => {
    // The generated homeworld has hundreds of habitable-space units of headroom, so a request
    // has to be well beyond the schema's own 100-level cap to hit the service's physical ceiling.
    const r = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 100_000 });
    expect(r.ok).toBe(false);
  });

  it("rejects a build with no free deposit slots, with the exact reason string", () => {
    // Force the ore deposit exhausted regardless of what world-gen rolled here (mirrors the
    // manufactured-eligibility idiom the colony test below uses): zero the homeworld's ore slots,
    // then ask for one more ore extractor level.
    const h = home();
    h.slotOre = 0;
    const r = orderBuild({ systemId: h.id, buildingType: "ore", levels: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("No free deposit slots for that building here.");
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
    const placed = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
    if (!placed.ok) throw new Error("setup failed");

    // Seed an auto-originated row for the same faction directly into the world — cancelOrder must
    // refuse it (origin !== "player") and leave it in place, not just refuse a made-up id.
    const w = getWorld();
    if (!w.player) throw new Error("fixture: expected a player seat");
    const autoProject: WorldBuildProject = {
      kind: "build", id: "auto-1", origin: "auto", factionId: w.player.controlledFactionId,
      systemId: home().id, buildingType: HOUSING_TYPE, levels: 1, workTotal: 10, workDone: 0,
    };
    setWorld({ ...w, constructionProjects: [...w.constructionProjects, autoProject] });
    expect(cancelOrder({ projectId: "auto-1" }).ok).toBe(false);
    expect(getWorld().constructionProjects.some((p) => p.id === "auto-1")).toBe(true);

    expect(cancelOrder({ projectId: placed.data.projectId }).ok).toBe(true);
    expect(getWorld().constructionProjects.some((p) => p.id === placed.data.projectId)).toBe(false);
    expect(cancelOrder({ projectId: "no-such-project" }).ok).toBe(false);
  });

  it("orders a colony at an eligible controlled system and rejects an ineligible one", () => {
    // Deterministically manufacture eligibility: take a controlled player system if the seed
    // produced one, else claim an unclaimed neighbour of the homeworld as controlled.
    const w = getWorld();
    const pid = w.player!.controlledFactionId;
    let target = w.systems.find((s) => s.factionId === pid && s.control === "controlled");
    if (!target) {
      const conn = w.connections.find((c) => c.fromId === home().id || c.toId === home().id)!;
      const otherId = conn.fromId === home().id ? conn.toId : conn.fromId;
      target = w.systems.find((s) => s.id === otherId)!;
      target.factionId = pid;
      target.control = "controlled";
    }
    fundPlayer(1_000_000); // amply solvent — this test is about the physical gates, not the price
    const r = orderColony({ systemId: target.id });
    if (target.habitableSpace >= 1) {
      expect(r.ok).toBe(true);
      const row = getWorld().constructionProjects.find((p) => p.kind === "colony_establish" && p.systemId === target.id)!;
      expect(row.origin).toBe("player");
      // A second order on the same system is "already forming".
      expect(orderColony({ systemId: target.id }).ok).toBe(false);
    } else {
      expect(r.ok).toBe(false); // below the habitable floor is a legitimate reject
    }
    // The developed homeworld is never colony-eligible.
    expect(orderColony({ systemId: home().id }).ok).toBe(false);
  });

  it("refuses a colony the treasury cannot commit to, at the mutation boundary", () => {
    // With colonisation automation off — the player's normal mode — the planner's affordability gate
    // never runs for the player's faction. If the price is only enforced in the read service the
    // order still lands, and the player is the one faction in the galaxy that founds for free: it
    // holds `already_forming` on the target for nothing and pushes the maintenance floor around.
    const target = controlledNeighbour(50);
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

    // Exactly affordable: the same order goes through, and the row opens owing both its charter and
    // its whole manifest.
    fundPlayer(cost);
    const placed = orderColony({ systemId: target.id });
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    const row = getWorld().constructionProjects.find(
      (p): p is WorldColonyEstablishProject =>
        p.kind === "colony_establish" && p.id === placed.data.projectId,
    )!;
    expect(row.charterPaid).toBe(false);
    expect(row.stagedManifest).toEqual([]);
    expect(row.stalledCycles).toBe(0);
  });

  it("returns a cancelled colony's staged goods to its founder, conserving total stock", () => {
    // The spec's conservation bar for cancellation: staged materials are real inventory, already out
    // of the founder's markets and paid for. Deleting the row without returning them destroys stock
    // the faction owns. Work and the charter stay forfeit — only the goods come home.
    // Manufacture an eligible controlled target next to the homeworld, with land well clear of the
    // habitable floor so nothing rejects on substrate, and a purse that covers the commitment.
    const target = controlledNeighbour(50);
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

  it("leaves every market row alone when a build order is cancelled", () => {
    const placed = orderBuild({ systemId: home().id, buildingType: HOUSING_TYPE, levels: 1 });
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
