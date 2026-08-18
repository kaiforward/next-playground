import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { getSystemBuildOptions } from "@/lib/services/build-options";
import { seatWorld, controlledNeighbour } from "./seat-world";
import { getSystemConstruction } from "@/lib/services/construction";
import { orderBuild } from "@/lib/services/construction-orders";
import { ServiceError } from "@/lib/services/errors";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { COLONISATION } from "@/lib/constants/colonisation";
import { foundingCommitmentCost } from "@/lib/engine/founding-cost";
import type { WorldConstructionProject } from "@/lib/world/types";

/** Comfortably above the habitable floor — every colony case below wants an unconstrained site. */
const AMPLE_HABITABLE = 100;

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

  it("throws ServiceError(409) when no world is loaded", () => {
    clearWorld();
    expect(() => getSystemBuildOptions("any-system")).toThrow(ServiceError);
    try {
      getSystemBuildOptions("any-system");
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
      expect(err.status).toBe(409);
    }
  });

  it("throws ServiceError(404) naming the id for an unknown system", () => {
    expect(() => getSystemBuildOptions("no-such-system")).toThrow(ServiceError);
    try {
      getSystemBuildOptions("no-such-system");
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
      expect(err.status).toBe(404);
      expect(err.message).toContain("no-such-system");
    }
  });

  it("returns none for the player's own system when it is neither controlled nor developed", () => {
    // The three-state model has no fourth state, so "not developed" past the controlled branch
    // means unclaimed — an owned-but-unclaimed system must not show either verb.
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const target = w.systems.find((s) => s.id !== f.homeworldId)!;
    target.factionId = f.id;
    target.control = "unclaimed";
    expect(getSystemBuildOptions(target.id).mode).toBe("none");
  });

  it("nets committed BUILD levels for THIS system only, every open project at it, ignoring other kinds", () => {
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const home = w.systems.find((s) => s.id === f.homeworldId)!;
    home.slotOre = 100; // headroom so maxLevels tracks the committed subtraction 1:1, not space-capped
    const otherSystemId = w.systems.find((s) => s.id !== home.id)!.id;

    const baseline = getSystemBuildOptions(home.id);
    if (baseline.mode !== "build") throw new Error("expected build mode");
    const oreBefore = baseline.options.find((o) => o.buildingType === "ore")!.maxLevels;

    const projects: WorldConstructionProject[] = [
      // Counts: kind "build" at home — twice, to prove accumulation.
      { kind: "build", id: "own-home-ore", origin: "auto", factionId: f.id, systemId: home.id, buildingType: "ore", levels: 3, workTotal: 30, workDone: 0 },
      { kind: "build", id: "own-home-ore-2", origin: "player", factionId: f.id, systemId: home.id, buildingType: "ore", levels: 2, workTotal: 20, workDone: 0 },
      // Counts too: the queue is folded by system, not by owner — the same fold `orderBuild` enforces
      // the ceiling with, so the planner can never quote headroom the order verb then refuses. (No
      // reachable state puts another faction's build at a system this one owns: a project's faction is
      // its target's owner at creation, and the only ownership change is abandonment, which drops the
      // system's build projects in the same pass — see dropAbandonedBuildProjects.)
      { kind: "build", id: "rival-home-ore", origin: "auto", factionId: "rival-faction", systemId: home.id, buildingType: "ore", levels: 4, workTotal: 40, workDone: 0 },
      // Does not count: a build of the same type at a DIFFERENT system.
      { kind: "build", id: "own-elsewhere-ore", origin: "auto", factionId: f.id, systemId: otherSystemId, buildingType: "ore", levels: 100, workTotal: 100, workDone: 0 },
      // Does not affect the "ore" total: a build of a DIFFERENT type at home.
      { kind: "build", id: "own-home-housing", origin: "auto", factionId: f.id, systemId: home.id, buildingType: HOUSING_TYPE, levels: 50, workTotal: 400, workDone: 0 },
    ];
    setWorld({
      ...getWorld(),
      constructionProjects: projects,
    });

    const after = getSystemBuildOptions(home.id);
    if (after.mode !== "build") throw new Error("expected build mode");
    const oreAfter = after.options.find((o) => o.buildingType === "ore")!.maxLevels;
    // Exactly 3 + 2 + 4 = 9 levels netted off — not the other system's 100, not the housing 50, and
    // not the arithmetic negated (which would ADD headroom instead of consuming it).
    expect(oreBefore - oreAfter).toBe(9);
    // …and the order verb, which folds the queue with the same helper, agrees to the level: one more
    // than the planner quotes is refused.
    expect(orderBuild({ systemId: home.id, buildingType: "ore", levels: oreAfter + 1 }).ok).toBe(false);
  });

  it("reads the system's actual built levels into the committed baseline — never a hardcoded empty map", () => {
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const home = w.systems.find((s) => s.id === f.homeworldId)!;
    home.habitableSpace = 200; // plenty of room so housing maxLevels tracks existing housing 1:1
    setWorld({
      ...getWorld(),
      buildings: [
        ...getWorld().buildings.filter((b) => !(b.systemId === home.id && b.buildingType === HOUSING_TYPE)),
        { systemId: home.id, buildingType: HOUSING_TYPE, count: 20, idleCycles: 0 },
      ],
    });
    const withHousing = getSystemBuildOptions(home.id);
    if (withHousing.mode !== "build") throw new Error("expected build mode");
    const maxWithHousing = withHousing.options.find((o) => o.buildingType === HOUSING_TYPE)!.maxLevels;

    setWorld({
      ...getWorld(),
      buildings: getWorld().buildings.filter((b) => !(b.systemId === home.id && b.buildingType === HOUSING_TYPE)),
    });
    const withoutHousing = getSystemBuildOptions(home.id);
    if (withoutHousing.mode !== "build") throw new Error("expected build mode");
    const maxWithoutHousing = withoutHousing.options.find((o) => o.buildingType === HOUSING_TYPE)!.maxLevels;

    // Removing 20 already-built housing levels must free up room, not read as no change (which is
    // what a hardcoded `{}` substituted for the real buildings map would produce either way).
    expect(maxWithoutHousing).toBeGreaterThan(maxWithHousing);
  });

  it("scopes the ETA pool to the player's own faction, and falls back a committed row with no founding ceiling to the scalar cap, not to zero", () => {
    // Two failure modes in one scenario: (a) a faction-pool filter that leaks a rival's population
    // would inflate the pool and land the hypothetical fast; (b) a per-project ceiling fallback that
    // silently became 0 instead of the scalar cap would make an ordinary committed BUILD (never in
    // the founding-ceilings map) absorb nothing forever — which, counter-intuitively, means it would
    // starve NOTHING and a hypothetical behind it would land almost immediately instead of waiting.
    // Pin the player's own population tiny so the whole pool sits well under one cap; then an
    // infinite-work committed row correctly capped at `cap` (not 0) eats the WHOLE pool every cycle
    // and the hypothetical behind it can never land within the forecast horizon.
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    const homeId = f.homeworldId;
    const factionId = f.id;
    const rival = w.systems.find((s) => s.factionId !== null && s.factionId !== factionId)!;

    setWorld({
      ...w,
      systems: w.systems.map((s) => {
        if (s.id === homeId) return { ...s, population: 10 };
        if (s.factionId === factionId) return { ...s, population: 0 };
        if (s.id === rival.id) return { ...s, population: 100_000 }; // must never enter the player's pool
        return s;
      }),
      buildings: w.buildings.filter((b) => b.systemId !== homeId), // no Construction Centre bonus
      constructionProjects: [{
        kind: "build", id: "endless-committed", origin: "auto", factionId,
        systemId: homeId, buildingType: HOUSING_TYPE, levels: 1,
        workTotal: 1_000_000, workDone: 0,
      }],
    });

    const data = getSystemBuildOptions(homeId);
    if (data.mode !== "build") throw new Error("expected build mode");
    const opt = data.options.find((o) => o.buildingType === HOUSING_TYPE)!;
    expect(opt.maxLevels).toBeGreaterThan(0);
    expect(opt.etaCycles).toBeNull();
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
    const { target, home } = controlledNeighbour(AMPLE_HABITABLE);
    fundPlayer(1_000_000);
    // Move `home` off index 0 so a resolver that just grabs the FIRST system in the array (instead of
    // matching on id) reads a different system's name here.
    setWorld({
      ...getWorld(),
      systems: [...getWorld().systems.filter((s) => s.id !== home.id), home],
    });

    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
    if (data.mode !== "colony") return;
    expect(data.colony.state).toBe("eligible");
    if (data.colony.state !== "eligible") return;
    expect(data.colony.preview.sourceSystemId).toBe(home.id);
    expect(data.colony.preview.sourceSystemName).toBe(home.name);
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
    const { target, home } = controlledNeighbour(AMPLE_HABITABLE);
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

  it("reads a penniless faction's colony verb as insufficient_funds, still carrying the quote", () => {
    // The read surface and the mutation boundary quote one price; here the purse is short of it and
    // the same reason the order would refuse with is what the verb displays. The quote it was
    // refused against rides along, so the UI can show what the verb WOULD cost.
    const { target, home } = controlledNeighbour(AMPLE_HABITABLE);
    fundPlayer(0);

    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
    if (data.mode !== "colony") return;
    expect(data.colony.state).toBe("ineligible");
    if (data.colony.state !== "ineligible") return;
    expect(data.colony.reason).toBe("insufficient_funds");
    expect(data.colony.preview).not.toBeNull();
    if (data.colony.preview === null) return;
    expect(data.colony.preview.sourceSystemId).toBe(home.id);
    expect(data.colony.preview.sourceSystemName).toBe(home.name);
    expect(data.colony.preview.seedPop).toBeGreaterThan(0);
    expect(data.colony.preview.housingLevels).toBeGreaterThanOrEqual(1);
    expect(data.colony.preview.charter).toBeGreaterThanOrEqual(COLONISATION.CHARTER_FEE_MIN);
    expect(data.colony.preview.projectedBill).toBeGreaterThan(0);
    // The quoted commitment is the gate's own threshold, from the same pricing function.
    expect(data.colony.preview.commitment).toBeCloseTo(
      foundingCommitmentCost(
        data.colony.preview.charter, data.colony.preview.projectedBill, COLONISATION.FOUNDING_GATE_HEADROOM,
      ),
      9,
    );
  });

  it("carries no quote on a physical block — no seed source means nothing to price against", () => {
    // The material projection is quoted off the seed source's own market rows, so with no developed
    // system in range there is no bill to project and the ineligible branch carries a null preview.
    const { target } = controlledNeighbour(AMPLE_HABITABLE);
    fundPlayer(1_000_000);
    const w = getWorld();
    const f = w.factions.find((x) => x.id === w.player?.controlledFactionId)!;
    setWorld({
      ...w,
      systems: w.systems.map((s) =>
        s.factionId === f.id && s.control === "developed" ? { ...s, control: "controlled" } : s,
      ),
    });

    const data = getSystemBuildOptions(target.id);
    expect(data.mode).toBe("colony");
    if (data.mode !== "colony") return;
    expect(data.colony.state).toBe("ineligible");
    if (data.colony.state !== "ineligible") return;
    expect(data.colony.reason).toBe("no_seed_source");
    expect(data.colony.preview).toBeNull();
  });
});
