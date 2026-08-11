import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, getWorld, clearWorld } from "@/lib/world/store";
import { colonyEligibility, findSeedSource, COLONY_REACH_HOPS } from "@/lib/services/colony-eligibility";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { DIRECTED_BUILD } from "@/lib/constants/directed-build";
import { EXPANSION } from "@/lib/constants/expansion";
import type { World, WorldConnection, WorldBuildProject, WorldColonyEstablishProject } from "@/lib/world/types";
import { HOUSING_TYPE } from "@/lib/constants/industry";

function baseWorld(): World {
  return generateWorld({ systemCount: 60, seed: 42 });
}

/** Wipe the generated connection graph so a test's own synthetic chain is the only path there is. */
function isolate(world: World): World {
  return { ...world, connections: [] };
}

beforeEach(() => { clearWorld(); setWorld(baseWorld()); });
afterEach(() => { clearWorld(); });

describe("findSeedSource", () => {
  it("excludes wrong-faction, non-developed and unreachable candidates, and never the origin itself", () => {
    const FACTION = "test-faction";
    const w = getWorld();
    const [origin, foreignDev, ownControlled, relayA, ownDevNear, ownDevFarther, unreachableDev] = w.systems;

    // The BFS start (h=0): marking it own+developed too proves the h<=0 guard, not just h===undefined.
    origin.factionId = FACTION; origin.control = "developed";
    // Strictly CLOSER (h=1) than the real winner, so a broken faction/control filter would win outright.
    foreignDev.factionId = "rival-faction"; foreignDev.control = "developed";
    ownControlled.factionId = FACTION; ownControlled.control = "controlled"; // owned, but not developed
    // The unique valid winner, at h=2.
    ownDevNear.factionId = FACTION; ownDevNear.control = "developed";
    // Own + developed, but farther (h=3) — must lose to ownDevNear.
    ownDevFarther.factionId = FACTION; ownDevFarther.control = "developed";
    // Own + developed, but with NO edge into this graph at all — must read as unreachable, not as h=0/closest.
    unreachableDev.factionId = FACTION; unreachableDev.control = "developed";

    const connections: WorldConnection[] = [
      { fromId: origin.id, toId: foreignDev.id, fuelCost: 1 },
      { fromId: origin.id, toId: ownControlled.id, fuelCost: 1 },
      { fromId: origin.id, toId: relayA.id, fuelCost: 1 },
      { fromId: relayA.id, toId: ownDevNear.id, fuelCost: 1 },
      { fromId: ownDevNear.id, toId: ownDevFarther.id, fuelCost: 1 },
    ];
    // unreachableDev placed FIRST: if a guard silently forgets to skip an out-of-range candidate, the
    // `best === null` clause lets it become `best` unconditionally on the very first iteration, and no
    // finite hop count can ever be `< undefined` afterwards — corrupting the result for the whole run.
    setWorld({
      ...isolate(w),
      systems: [unreachableDev, origin, foreignDev, ownControlled, relayA, ownDevNear, ownDevFarther],
      connections,
    });

    expect(findSeedSource(getWorld(), FACTION, origin.id)).toBe(ownDevNear.id);
  });

  it("ties on hop count break to the smallest system id (candidate encountered first, tie-break decides)", () => {
    const FACTION = "test-faction";
    const w = getWorld();
    const [origin, sysA, sysB] = w.systems;
    const [smaller, larger] = [sysA, sysB].sort((a, b) => (a.id < b.id ? -1 : 1));
    smaller.factionId = FACTION; smaller.control = "developed";
    larger.factionId = FACTION; larger.control = "developed";
    const connections: WorldConnection[] = [
      { fromId: origin.id, toId: smaller.id, fuelCost: 1 },
      { fromId: origin.id, toId: larger.id, fuelCost: 1 },
    ];
    // smaller processed BEFORE larger: correct code keeps `smaller` on the tie; a comparator broken to
    // "always overwrite on a tie" (<=, >=) or "no id check at all" would instead take `larger`, the
    // last one seen.
    setWorld({ ...isolate(w), systems: [origin, smaller, larger], connections });

    expect(findSeedSource(getWorld(), FACTION, origin.id)).toBe(smaller.id);
  });

  it("ties on hop count break to the smallest id even when the smaller id is seen SECOND", () => {
    const FACTION = "test-faction";
    const w = getWorld();
    const [origin, sysA, sysB] = w.systems;
    const [smaller, larger] = [sysA, sysB].sort((a, b) => (a.id < b.id ? -1 : 1));
    smaller.factionId = FACTION; smaller.control = "developed";
    larger.factionId = FACTION; larger.control = "developed";
    const connections: WorldConnection[] = [
      { fromId: origin.id, toId: larger.id, fuelCost: 1 },
      { fromId: origin.id, toId: smaller.id, fuelCost: 1 },
    ];
    // larger processed FIRST this time: a comparator with the tie-break disabled entirely (never
    // updates on `h === best.h`) would freeze on whichever was seen first — `larger` — instead of
    // updating to the smaller id once it's seen.
    setWorld({ ...isolate(w), systems: [origin, larger, smaller], connections });

    expect(findSeedSource(getWorld(), FACTION, origin.id)).toBe(smaller.id);
  });

  it("never lets a smaller id from a FARTHER system win over a nearer one", () => {
    const FACTION = "test-faction";
    const w = getWorld();
    const [origin, relayA, sysA, sysB] = w.systems;
    // Force the FARTHER candidate to hold the smaller id — a tie-break bug that drops the hop-equality
    // requirement (comparing ids unconditionally) would pick this one purely on id, despite it being
    // two hops farther away.
    const [smallerId, largerId] = [sysA, sysB].sort((a, b) => (a.id < b.id ? -1 : 1));
    const candFar = smallerId, candNear = largerId;
    candNear.factionId = FACTION; candNear.control = "developed";
    candFar.factionId = FACTION; candFar.control = "developed";
    const connections: WorldConnection[] = [
      { fromId: origin.id, toId: candNear.id, fuelCost: 1 }, // h=1
      { fromId: origin.id, toId: relayA.id, fuelCost: 1 },
      { fromId: relayA.id, toId: candFar.id, fuelCost: 1 },  // h=2
    ];
    setWorld({ ...isolate(w), systems: [origin, candNear, relayA, candFar], connections });

    expect(findSeedSource(getWorld(), FACTION, origin.id)).toBe(candNear.id);
  });

  it("returns null, without throwing, when nothing eligible is reachable", () => {
    const FACTION = "test-faction";
    const w = getWorld();
    const [origin] = w.systems;
    setWorld({ ...isolate(w), connections: [] });
    expect(() => findSeedSource(getWorld(), FACTION, origin.id)).not.toThrow();
    expect(findSeedSource(getWorld(), FACTION, origin.id)).toBeNull();
  });

  it("reaches exactly as far as the tick's own shared hop radius (max of the three source constants)", () => {
    // COLONY_REACH_HOPS is authored as Math.max(...) so the seed-source search matches whichever of
    // the tick's own reach constants is largest — currently DIRECTED_LOGISTICS/DIRECTED_BUILD's 4,
    // strictly more than EXPANSION.REACH_JUMPS's 3. Placing the only candidate exactly at that
    // radius (not one hop short) is what would catch a swap to Math.min.
    expect(COLONY_REACH_HOPS).toBe(
      Math.max(DIRECTED_LOGISTICS.MAX_HOPS, DIRECTED_BUILD.MAX_HOPS, EXPANSION.REACH_JUMPS),
    );
    const FACTION = "test-faction";
    const w = getWorld();
    const [origin, h1, h2, h3, farSystem] = w.systems;
    farSystem.factionId = FACTION; farSystem.control = "developed";
    const connections: WorldConnection[] = [
      { fromId: origin.id, toId: h1.id, fuelCost: 1 },
      { fromId: h1.id, toId: h2.id, fuelCost: 1 },
      { fromId: h2.id, toId: h3.id, fuelCost: 1 },
      { fromId: h3.id, toId: farSystem.id, fuelCost: 1 }, // exactly COLONY_REACH_HOPS away
    ];
    setWorld({ ...isolate(w), systems: [origin, h1, h2, h3, farSystem], connections });

    expect(findSeedSource(getWorld(), FACTION, origin.id)).toBe(farSystem.id);
  });
});

describe("colonyEligibility", () => {
  /** A funded faction with a developed seed source directly next to a controlled target. */
  function eligibleFixture() {
    const w = getWorld();
    const faction = w.factions[0];
    const source = w.systems[0];
    source.factionId = faction.id;
    source.control = "developed";
    const conn = w.connections.find((c) => c.fromId === source.id || c.toId === source.id)!;
    const otherId = conn.fromId === source.id ? conn.toId : conn.fromId;
    const target = w.systems.find((s) => s.id === otherId)!;
    target.factionId = faction.id;
    target.control = "controlled";
    target.habitableSpace = 50;
    setWorld({
      ...w,
      constructionProjects: [],
      treasuries: w.treasuries.map((t) =>
        t.factionId === faction.id ? { ...t, balance: Number.MAX_SAFE_INTEGER } : t,
      ),
    });
    return { faction, source, target };
  }

  it("blocks already_forming only for a colony_establish project at THIS exact system", () => {
    const { faction, source, target } = eligibleFixture();
    const decoyBuildHere: WorldBuildProject = {
      kind: "build", id: "decoy-build", origin: "auto", factionId: faction.id,
      systemId: target.id, buildingType: HOUSING_TYPE, levels: 1, workTotal: 8, workDone: 0,
    };
    const decoyColonyElsewhere: WorldColonyEstablishProject = {
      kind: "colony_establish", id: "decoy-colony", origin: "auto", factionId: faction.id,
      systemId: source.id, sourceSystemId: source.id, seedPop: 2, housingLevels: 1,
      workTotal: 10, workDone: 0, stagedManifest: [], charterPaid: true, stalledCycles: 0,
    };
    setWorld({ ...getWorld(), constructionProjects: [decoyBuildHere, decoyColonyElsewhere] });
    const stillEligible = colonyEligibility(getWorld(), faction.id, target);
    expect(stillEligible.eligible).toBe(true);

    const blocker: WorldColonyEstablishProject = { ...decoyColonyElsewhere, id: "blocker", systemId: target.id };
    setWorld({ ...getWorld(), constructionProjects: [decoyBuildHere, decoyColonyElsewhere, blocker] });
    const blocked = colonyEligibility(getWorld(), faction.id, target);
    expect(blocked.eligible).toBe(false);
    if (blocked.eligible) return;
    expect(blocked.reason).toBe("already_forming");
  });

  it("does not reject exactly AT the habitable floor — only strictly below it", () => {
    // DEVELOP_HABITABLE_FLOOR is 1 and housing's space cost is 1, so a system exactly at the floor
    // fits exactly one housing level: `<` must let it through, `<=` would wrongly reject it, and
    // the two are only distinguishable exactly at this boundary.
    const { faction, target } = eligibleFixture();
    target.habitableSpace = EXPANSION.DEVELOP_HABITABLE_FLOOR;
    const check = colonyEligibility(getWorld(), faction.id, target);
    expect(check.eligible).toBe(true);
  });

  it("rejects a system strictly below the habitable floor as below_habitable_floor", () => {
    const { faction, target } = eligibleFixture();
    target.habitableSpace = 0;
    const check = colonyEligibility(getWorld(), faction.id, target);
    expect(check.eligible).toBe(false);
    if (check.eligible) return;
    expect(check.reason).toBe("below_habitable_floor");
  });

  it("reads a non-finite habitableSpace as ineligible, not as a crash", () => {
    // A NaN habitableSpace passes the `< FLOOR` comparison (every comparison with NaN is false), so
    // the sizing computation's own isFinite guard is the only thing standing between this and a
    // read that dereferences a null sizing.
    const { faction, target } = eligibleFixture();
    target.habitableSpace = Number.NaN;
    let check: ReturnType<typeof colonyEligibility> | undefined;
    expect(() => { check = colonyEligibility(getWorld(), faction.id, target); }).not.toThrow();
    expect(check?.eligible).toBe(false);
    if (!check || check.eligible) return;
    expect(check.reason).toBe("below_habitable_floor");
  });

  it("reads no reachable developed source as no_seed_source, not as free eligibility", () => {
    const { faction, source, target } = eligibleFixture();
    source.control = "controlled"; // demote the only developed system in reach
    const check = colonyEligibility(getWorld(), faction.id, target);
    expect(check.eligible).toBe(false);
    if (check.eligible) return;
    expect(check.reason).toBe("no_seed_source");
  });
});
