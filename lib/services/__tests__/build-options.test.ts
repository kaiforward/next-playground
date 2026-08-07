import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getSystemBuildOptions } from "@/lib/services/build-options";
import { getSystemConstruction } from "@/lib/services/construction";
import { orderBuild } from "@/lib/services/construction-orders";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { COLONISATION } from "@/lib/constants/colonisation";
import type { WorldConstructionProject } from "@/lib/world/types";

function seatWorld() {
  return generateWorld({
    systemCount: 60, seed: 42,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}

/** World-gen starts every treasury at zero, and founding is priced — a colony preview needs a purse. */
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
function controlledNeighbour() {
  const w = getWorld();
  const faction = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
  const home = w.systems.find((s) => s.id === faction.homeworldId)!;
  const conn = w.connections.find((c) => c.fromId === home.id || c.toId === home.id)!;
  const otherId = conn.fromId === home.id ? conn.toId : conn.fromId;
  const target = w.systems.find((s) => s.id === otherId)!;
  target.factionId = faction.id;
  target.control = "controlled";
  target.habitableSpace = 100; // comfortably above the habitable floor
  return { target, home };
}

describe("getSystemBuildOptions", () => {
  beforeEach(() => { clearWorld(); setWorld(seatWorld()); });

  it("returns build mode with labelled options at the player's developed homeworld", () => {
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const home = w.systems.find((s) => s.id === f.homeworldId)!;
    // Deterministically exhaust ore deposit slots regardless of what world-gen rolled, so there's
    // always a zero-maxLevels / null-etaCycles option to assert against.
    home.slotOre = 0;

    const data = getSystemBuildOptions(f.homeworldId);
    expect(data.mode).toBe("build");
    if (data.mode !== "build") return;

    const housing = data.options.find((o) => o.buildingType === HOUSING_TYPE)!;
    expect(housing.label).toBe("Housing");
    expect(housing.workPerLevel).toBeGreaterThan(0);
    expect(housing.maxLevels).toBeGreaterThan(0);
    expect(housing.etaCycles).not.toBeNull();
    if (housing.etaCycles === null) return;
    expect(Number.isFinite(housing.etaCycles)).toBe(true);
    expect(housing.etaCycles).toBeGreaterThanOrEqual(1);

    const ore = data.options.find((o) => o.buildingType === "ore")!;
    expect(ore.maxLevels).toBe(0);
    expect(ore.etaCycles).toBeNull();

    // Ordering housing now commits work ahead of a fresh hypothetical row for the same type — a
    // subsequent read's etaCycles for housing can only stay the same or move back, never improve.
    const placed = orderBuild({ systemId: f.homeworldId, buildingType: HOUSING_TYPE, levels: 1 });
    expect(placed.ok).toBe(true);
    const after = getSystemBuildOptions(f.homeworldId);
    if (after.mode !== "build") throw new Error("expected build mode after order");
    const afterHousing = after.options.find((o) => o.buildingType === HOUSING_TYPE)!;
    expect(afterHousing.etaCycles).not.toBeNull();
    if (afterHousing.etaCycles === null) return;
    expect(afterHousing.etaCycles).toBeGreaterThanOrEqual(housing.etaCycles);
  });

  it("returns none for a rival faction's system", () => {
    const w = getWorld();
    const foreign = w.systems.find(
      (s) => s.factionId !== null && s.factionId !== w.player?.controlledFactionId,
    )!;
    expect(getSystemBuildOptions(foreign.id).mode).toBe("none");
  });

  it("returns none for every system in a playerless world", () => {
    clearWorld();
    setWorld(generateWorld({ systemCount: 40, seed: 7 }));
    const w = getWorld();
    expect(w.player).toBeNull();
    for (const s of w.systems) {
      expect(getSystemBuildOptions(s.id).mode).toBe("none");
    }
  });

  it("returns colony mode with a deterministic, priced eligible preview at a controlled neighbour", () => {
    // Always manufacture the eligible case from home's direct neighbour rather than trusting
    // whatever "controlled" system world-gen happened to produce — a pre-existing one could sit
    // outside the seed-source hop radius, making the eligible/ineligible branch nondeterministic.
    const { target, home } = controlledNeighbour();
    fundPlayer(1_000_000);

    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
    if (data.mode !== "colony") return;
    expect(data.colony.state).toBe("eligible");
    if (data.colony.state !== "eligible") return;
    expect(data.colony.preview.sourceSystemId).toBe(home.id);
    expect(data.colony.preview.seedPop).toBeGreaterThan(0);
    expect(data.colony.preview.housingLevels).toBeGreaterThanOrEqual(1);
    // The preview carries the price so the UI never recomputes it: the charter is at least its
    // floor, and the material projection is a real bill for a seed that genuinely consumes goods.
    expect(data.colony.preview.charter).toBeGreaterThanOrEqual(COLONISATION.CHARTER_FEE_MIN);
    expect(data.colony.preview.projectedBill).toBeGreaterThan(0);
  });

  it("does not charge a build's ETA for pool a gated colony ahead of it never takes", () => {
    // A charter-paid colony sits in the committed prefix ahead of everything the player can order.
    // With the treasury unable to buy its next materials the tick holds its absorption at zero and
    // funds the queue behind it as if it were not there — so the ETA quoted for a fresh order must
    // not be pushed back by pool that colony will never consume.
    const { target, home } = controlledNeighbour();
    fundPlayer(0);
    const w = getWorld();
    const gated: WorldConstructionProject = {
      kind: "colony_establish", id: "gated-colony", origin: "auto",
      factionId: w.player!.controlledFactionId, systemId: target.id, sourceSystemId: home.id,
      seedPop: 2, housingLevels: 1, workTotal: 10_000, workDone: 40,
      stagedManifest: [], charterPaid: true, stalledCycles: 3,
    };
    // The founder's shelves are full, so nothing the colony wants is unsparable: what it cannot
    // stage is the treasury's doing alone, and its ceiling sits at zero rather than part-way. The
    // faction's heads are cut to a pool of roughly ONE absorption cap, so whether the colony ahead
    // takes a cap or nothing is the whole difference between the two readings below.
    const factionId = w.player!.controlledFactionId;
    setWorld({
      ...w,
      constructionProjects: [gated],
      markets: w.markets.map((m) => (m.systemId === home.id ? { ...m, stock: 1_000_000 } : m)),
      // No industry to license heads away and 90 of them left: the pool is ≈ 4.5, barely more than
      // one absorption cap, so whether the colony ahead takes a cap or nothing IS the difference
      // between the two readings below.
      buildings: w.buildings.filter((b) => b.systemId !== home.id),
      systems: w.systems.map((s) =>
        s.factionId !== factionId ? s : { ...s, population: s.id === home.id ? 90 : 0 },
      ),
    });

    // The premise: this colony really is money-gated, so it absorbs nothing this cycle.
    const colonyView = getSystemConstruction(target.id);
    expect(colonyView.visibility).toBe("visible");
    if (colonyView.visibility !== "visible") return;
    const row = colonyView.projects.find((p) => p.id === "gated-colony");
    expect(row?.kind).toBe("colony_establish");
    if (row === undefined || row.kind !== "colony_establish") return;
    expect(row.stalledReason).toBe("awaiting_funds");
    expect(row.nextCycleGain).toBe(0);

    const withColony = getSystemBuildOptions(home.id);
    setWorld({ ...getWorld(), constructionProjects: [] });
    const alone = getSystemBuildOptions(home.id);
    if (withColony.mode !== "build" || alone.mode !== "build") throw new Error("expected build mode");
    const etaOf = (data: typeof alone) =>
      data.options.find((o) => o.buildingType === HOUSING_TYPE)?.etaCycles ?? null;
    expect(etaOf(alone)).not.toBeNull();
    expect(etaOf(withColony)).toBe(etaOf(alone));
  });

  it("reads a penniless faction's colony verb as insufficient_funds", () => {
    // The read surface and the mutation boundary quote one price; here the purse is short of it and
    // the same reason the order would refuse with is what the verb displays.
    const { target } = controlledNeighbour();
    fundPlayer(0);

    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
    if (data.mode !== "colony") return;
    expect(data.colony.state).toBe("ineligible");
    if (data.colony.state !== "ineligible") return;
    expect(data.colony.reason).toBe("insufficient_funds");
  });
});
