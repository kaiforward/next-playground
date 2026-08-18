import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { DEFAULT_TRACKER_SECTIONS } from "@/lib/constants/attention";
import { setWorld, getWorld, clearWorld } from "@/lib/world/store";
import { getTrackerData } from "@/lib/services/tracker";
import { seatWorld } from "./seat-world";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { GET } from "@/app/api/game/player/tracker/route";
import type { World } from "@/lib/world/types";

afterEach(() => {
  clearWorld();
});

describe("getTrackerData", () => {
  // A default-shaped world reads the same sections whether this returns the stored record or a
  // hardcoded all-on literal, so the only test that can tell them apart is one that stores
  // something OTHER than the default first.
  it("returns the seat's OWN stored sections, not the authored default", () => {
    const world = seatWorld();
    setWorld({
      ...world,
      player: { ...world.player!, trackerSections: { pinned: false, building: true, colonising: false } },
    });

    expect(getTrackerData().sections).toEqual({
      pinned: false,
      building: true,
      colonising: false,
    });
  });

  it("filters a pinned system that has been abandoned back to unclaimed, rather than returning zeroed vitals", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;
    setWorld({ ...world, player: { ...world.player!, pinnedSystemIds: [home] } });

    // Sanity: while still developed and owned, the pin is visible.
    expect(getTrackerData().pinned.map((p) => p.systemId)).toEqual([home]);

    // Abandoned back to unclaimed frontier — nothing touches pinnedSystemIds itself.
    const current = getWorld();
    setWorld({
      ...current,
      systems: current.systems.map((s) =>
        s.id === home ? { ...s, control: "unclaimed", factionId: null } : s,
      ),
    });

    expect(getTrackerData().pinned).toEqual([]);
  });

  it("keeps a pin the display list drops on `pinnedSystemIds`, so the star toggle can still clear it", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    // A merely CONTROLLED system: pinnable (a pin is a bookmark, not an ownership claim) but it
    // reads no vitals, so it can never appear in `pinned`. Before `pinnedSystemIds` existed, the
    // toggle joined against `pinned`, showed this pin as unpinned, and re-sent `pinned: true` on
    // every click — the pin was unremovable for the life of the save.
    const site = world.systems.find((s) => s.id !== world.factions.find((f) => f.id === pid)!.homeworldId);
    if (!site) throw new Error("fixture: expected a spare system");

    setWorld({
      ...world,
      systems: world.systems.map((s) =>
        s.id === site.id ? { ...s, factionId: pid, control: "controlled" as const } : s,
      ),
      player: { ...world.player!, pinnedSystemIds: [site.id] },
    });

    const data = getTrackerData();
    expect(data.pinned).toEqual([]);
    expect(data.pinnedSystemIds).toEqual([site.id]);
  });

  it("carries `pinnedSystemIds` in stored order, including an id whose system no longer exists", () => {
    const world = seatWorld();
    const home = world.factions.find((f) => f.id === world.player!.controlledFactionId)!.homeworldId;
    setWorld({ ...world, player: { ...world.player!, pinnedSystemIds: ["ghost-system", home] } });

    const data = getTrackerData();
    // The display list drops the id that names nothing; the toggle's list keeps every stored id, in
    // the order the player added them, so unpinning is possible from wherever a pin came from.
    expect(data.pinned.map((p) => p.systemId)).toEqual([home]);
    expect(data.pinnedSystemIds).toEqual(["ghost-system", home]);
  });

  it("still returns a pinned system belonging to another faction — pinning is a bookmark, not an ownership claim", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const rival = world.systems.find(
      (s) => s.control === "developed" && s.factionId !== null && s.factionId !== pid,
    );
    if (!rival) throw new Error("fixture: expected a rival developed system");
    setWorld({ ...world, player: { ...world.player!, pinnedSystemIds: [rival.id] } });

    const data = getTrackerData();
    expect(data.pinned.map((p) => p.systemId)).toEqual([rival.id]);
    expect(data.pinned[0].systemName).toBe(rival.name);
  });

  it("returns empty sections rather than throwing on a world with no player seat", () => {
    setWorld(generateWorld({ systemCount: 60, seed: 42 })); // no playerFaction => player is null
    expect(getWorld().player).toBeNull();

    let data: ReturnType<typeof getTrackerData> | undefined;
    expect(() => {
      data = getTrackerData();
    }).not.toThrow();
    expect(data).toEqual({
      pinnedSystemIds: [],
      pinned: [],
      building: [],
      waitingCount: 0,
      colonising: [],
      // No seat means no stored preference to read, so the sections fall back to the authored
      // default rather than being absent — every reader of `sections` can index it unconditionally.
      sections: DEFAULT_TRACKER_SECTIONS,
    });
  });

  it("scopes `building` to the player faction's own funded front, never a rival's queue", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;
    const rival = world.systems.find(
      (s) => s.control === "developed" && s.factionId !== null && s.factionId !== pid,
    );
    if (!rival || rival.factionId === null) throw new Error("fixture: expected a rival developed system");

    setWorld({
      ...world,
      constructionProjects: [
        {
          kind: "build", id: "p1", origin: "player", factionId: pid, systemId: home,
          buildingType: "housing", levels: 1, workTotal: 40, workDone: 0,
        },
        {
          kind: "build", id: "r1", origin: "player", factionId: rival.factionId, systemId: rival.id,
          buildingType: "housing", levels: 1, workTotal: 40, workDone: 0,
        },
      ],
    });

    const data = getTrackerData();
    expect(data.building.length).toBeGreaterThan(0);
    expect(data.building.some((b) => b.systemId === home)).toBe(true);
    expect(data.building.every((b) => b.systemId !== rival.id)).toBe(true);
  });

  it("preserves pinnedSystemIds order after stale entries are filtered, rather than re-sorting", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;
    const spare = world.systems.filter((s) => s.id !== home).slice(0, 2);
    const [first, stale] = spare;
    if (!first || !stale) throw new Error("fixture: expected two more systems");

    // Named so a by-name sort would read backwards from insertion order: "Zulu" (first-pinned) would
    // sort AFTER "Alpha" (last-pinned) alphabetically — the two orders disagree on purpose.
    const systems = world.systems.map((s) => {
      if (s.id === first.id) return { ...s, name: "Zulu Colony", factionId: pid, control: "developed" as const };
      if (s.id === stale.id) return { ...s, name: "Mid Colony", factionId: pid, control: "developed" as const };
      if (s.id === home) return { ...s, name: "Alpha Colony" };
      return s;
    });

    setWorld({
      ...world,
      systems,
      player: { ...world.player!, pinnedSystemIds: [first.id, stale.id, home] },
    });

    // Abandon the middle pin.
    const current = getWorld();
    setWorld({
      ...current,
      systems: current.systems.map((s) =>
        s.id === stale.id ? { ...s, control: "unclaimed", factionId: null } : s,
      ),
    });

    expect(getTrackerData().pinned.map((p) => p.systemId)).toEqual([first.id, home]);
  });

  /** Pins `home` after writing `fields` onto it, and returns the resulting row. */
  function pinnedHomeRow(fields: Partial<World["systems"][number]>) {
    const world = seatWorld();
    const home = world.factions.find((f) => f.id === world.player!.controlledFactionId)!.homeworldId;
    setWorld({
      ...world,
      systems: world.systems.map((s) => (s.id === home ? { ...s, ...fields } : s)),
      player: { ...world.player!, pinnedSystemIds: [home] },
    });
    const row = getTrackerData().pinned[0];
    if (!row) throw new Error("fixture: expected the homeworld pin to render");
    return { home, row };
  }

  it("derives a pinned row's figures from that system's own seeded state", () => {
    // Every figure is given a DIFFERENT value, so a row that read the wrong field — or the same
    // field twice — could not still pass: 30 heads, 75% of cap, 82% stability, 63% provisioned.
    const { home, row } = pinnedHomeRow({
      population: 30,
      popCap: 40,
      unrest: 0.18,
      provision: 0.63,
      supplyBand: "supplied",
    });

    expect(row.population).toBe(30);
    expect(row.populationPct).toBeCloseTo(75, 10);
    expect(row.stabilityPct).toBeCloseTo(82, 10);
    expect(row.unrest).toBeCloseTo(0.18, 10);
    expect(row.provisionPct).toBeCloseTo(63, 10);
    // Development is the ONE figure this service cannot restate from the row's own inputs, and the
    // service's whole claim is that it is the system panel's figure rather than a second definition
    // of it — so it is asserted against that read, not against a number copied out of a past run.
    const vitals = getSystemVitals(home);
    if (vitals.visibility !== "visible") throw new Error("fixture: expected visible vitals");
    expect(row.developmentPct).toBe(vitals.development.pct);
    expect(vitals.development.pct).toBeGreaterThan(0); // …and not a vacuous 0 === 0
  });

  it("reads populationPct as 0 for a system with no population cap, rather than dividing by it", () => {
    // A 0 cap would divide to Infinity, which `JSON.stringify` writes as `null` — the row would
    // reach the panel with no figure at all.
    const { row } = pinnedHomeRow({ population: 12, popCap: 0 });

    expect(row.populationPct).toBe(0);
    expect(Number.isFinite(row.populationPct)).toBe(true);
  });

  it("reads provisionPct as null for a system the economy has never assessed, never as 0%", () => {
    // A generated world has no provision reading until the economy has run a cycle. 0 here would
    // render as a measured total famine on a world that has simply not been measured yet.
    const { row } = pinnedHomeRow({ provision: undefined, supplyBand: undefined });

    expect(row.provisionPct).toBeNull();
  });

  it("does not double-count a stalled colony behind the front in waitingCount, though it is listed in colonising", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;
    const colonySite = world.systems.find((s) => s.id !== home);
    if (!colonySite) throw new Error("fixture: expected a spare system");

    const systems = world.systems.map((s) => {
      if (s.id === home) return { ...s, population: 80 };
      if (s.id === colonySite.id) {
        return { ...s, factionId: pid, control: "controlled" as const, population: 0 };
      }
      // Neutralise any other system this faction starts owning, so the pool comes from `home` alone
      // (population 80 at THROUGHPUT_PER_POP 0.05 = pool 4, exactly one build project's cap).
      if (s.factionId === pid) return { ...s, population: 0 };
      return s;
    });
    // `computeFactionConstruction`'s pool reads built buildings from `world.buildings` (a top-level
    // index, not `WorldSystem.buildings`) — strip every faction-owned system's built base so the
    // pool comes out to exactly population × THROUGHPUT_PER_POP, with no skilled-labour split.
    const pidSystemIds = new Set(systems.filter((s) => s.factionId === pid).map((s) => s.id));
    const buildings = world.buildings.filter((b) => !pidSystemIds.has(b.systemId));

    setWorld({
      ...world,
      systems,
      buildings,
      constructionProjects: [
        // Consumes the whole pool (cap 4) this cycle — the front.
        {
          kind: "build", id: "front", origin: "auto", factionId: pid, systemId: home,
          buildingType: "housing", levels: 1, workTotal: 8, workDone: 0,
        },
        // Queued behind it: pool is exhausted, so this colony absorbs nothing this cycle.
        {
          kind: "colony_establish", id: "c1", origin: "auto", factionId: pid, systemId: colonySite.id,
          sourceSystemId: home, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 10,
          stagedManifest: [], charterPaid: true, stalledCycles: 0,
        },
      ],
    });

    const data = getTrackerData();
    // The colony is listed — every forming colony gets a row whether funded this cycle or not.
    expect(data.colonising.map((c) => c.systemId)).toEqual([colonySite.id]);
    // …but it must not ALSO be counted in waitingCount: only the one behind-the-front BUILD does.
    expect(data.building.length).toBe(1);
    expect(data.waitingCount).toBe(0);
  });

  it("counts a build project behind the front in waitingCount", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;

    const systems = world.systems.map((s) => {
      if (s.id === home) return { ...s, population: 80 }; // pool = 4, one build's cap
      if (s.factionId === pid) return { ...s, population: 0 };
      return s;
    });
    const pidSystemIds = new Set(systems.filter((s) => s.factionId === pid).map((s) => s.id));
    const buildings = world.buildings.filter((b) => !pidSystemIds.has(b.systemId));

    setWorld({
      ...world,
      systems,
      buildings,
      constructionProjects: [
        {
          kind: "build", id: "front", origin: "auto", factionId: pid, systemId: home,
          buildingType: "housing", levels: 1, workTotal: 8, workDone: 0,
        },
        {
          kind: "build", id: "behind", origin: "auto", factionId: pid, systemId: home,
          buildingType: "housing", levels: 1, workTotal: 8, workDone: 0,
        },
      ],
    });

    const data = getTrackerData();
    expect(data.building.length).toBe(1);
    expect(data.waitingCount).toBe(1);
  });

  it("carries the coming cycle's real gain per row — and a 0 for a colony the pool cannot reach, never the front's rate", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;
    const colonySite = world.systems.find((s) => s.id !== home);
    if (!colonySite) throw new Error("fixture: expected a spare system");

    const systems = world.systems.map((s) => {
      if (s.id === home) return { ...s, population: 80 }; // pool = 4, exactly one build's cap
      if (s.id === colonySite.id) {
        return { ...s, factionId: pid, control: "controlled" as const, population: 0 };
      }
      if (s.factionId === pid) return { ...s, population: 0 };
      return s;
    });
    const pidSystemIds = new Set(systems.filter((s) => s.factionId === pid).map((s) => s.id));
    const buildings = world.buildings.filter((b) => !pidSystemIds.has(b.systemId));

    setWorld({
      ...world,
      systems,
      buildings,
      constructionProjects: [
        // Absorbs the whole pool: 4 of 8 work, so half the bar is forecast to fill next cycle.
        {
          kind: "build", id: "front", origin: "auto", factionId: pid, systemId: home,
          buildingType: "housing", levels: 1, workTotal: 8, workDone: 0,
        },
        // Behind it with the pool exhausted — it absorbs nothing, and its row must say so.
        {
          kind: "colony_establish", id: "c1", origin: "auto", factionId: pid, systemId: colonySite.id,
          sourceSystemId: home, seedPop: 2, housingLevels: 1, workTotal: 100, workDone: 10,
          stagedManifest: [], charterPaid: true, stalledCycles: 0,
        },
      ],
    });

    const data = getTrackerData();
    // The real fundQueue step in the row's own units, not a flat "some progress" placeholder.
    expect(data.building[0].nextCycleProgress).toBeCloseTo(0.5, 10);
    // The colony absorbs nothing THIS cycle, and its gain says so — it must not borrow the build's 0.5.
    expect(data.colonising[0].nextCycleProgress).toBe(0);
    // …but it still has a forecast: the ETA replays the queue, so a colony behind the front lands
    // once the front clears. The em-dash means "no forecast at all", and printing it here would
    // report a starved colony as a permanently stalled one.
    expect(data.colonising[0].etaCycles).not.toBeNull();
    expect(data.colonising[0].etaCycles).toBeGreaterThan(data.building[0].etaCycles!);
  });

  it("forecasts a near-complete project its remaining work, so its bar finishes rather than overflowing", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;

    const systems = world.systems.map((s) => {
      if (s.id === home) return { ...s, population: 80 }; // pool 4 — twice the work this project has left
      if (s.factionId === pid) return { ...s, population: 0 };
      return s;
    });
    const pidSystemIds = new Set(systems.filter((s) => s.factionId === pid).map((s) => s.id));
    const buildings = world.buildings.filter((b) => !pidSystemIds.has(b.systemId));

    setWorld({
      ...world,
      systems,
      buildings,
      constructionProjects: [
        {
          kind: "build", id: "nearly", origin: "auto", factionId: pid, systemId: home,
          buildingType: "housing", levels: 1, workTotal: 8, workDone: 6,
        },
      ],
    });

    const row = getTrackerData().building[0];
    expect(row.progress).toBeCloseTo(0.75, 10);
    // 2 work left of 8, not the cap's 4 — the pair sums to exactly a full bar.
    expect(row.nextCycleProgress).toBeCloseTo(0.25, 10);
    expect(row.progress + row.nextCycleProgress).toBeCloseTo(1, 10);
  });

  it("splits building/colonising by a project's kind, not its systemId — a build and a colony sharing a system are not conflated", () => {
    const world = seatWorld();
    const pid = world.player!.controlledFactionId;
    const home = world.factions.find((f) => f.id === pid)!.homeworldId;

    const systems = world.systems.map((s) => {
      // pool = 10 (population 200 at 0.05): enough to fully fund both projects' cap-4 draws this cycle.
      if (s.id === home) return { ...s, population: 200 };
      if (s.factionId === pid) return { ...s, population: 0 };
      return s;
    });
    const pidSystemIds = new Set(systems.filter((s) => s.factionId === pid).map((s) => s.id));
    const buildings = world.buildings.filter((b) => !pidSystemIds.has(b.systemId));

    setWorld({
      ...world,
      systems,
      buildings,
      constructionProjects: [
        // Both projects target the SAME system id — the collision a systemId-keyed lookup conflates.
        // Their work totals differ (60 vs 20) so their ETAs cannot coincide: with equal totals the
        // two figures agree by accident and a row reading the WRONG project's ETA still passes.
        // The colony goes FIRST in the queue (`orderOpenProjects` keeps committed order), so a
        // last-one-wins Map keyed on systemId resolves to the BUILD — the colony would inherit the
        // build's ETA and the swap would be visible rather than masked by ordering luck.
        {
          kind: "colony_establish", id: "c1", origin: "auto", factionId: pid, systemId: home,
          sourceSystemId: home, seedPop: 2, housingLevels: 1, workTotal: 60, workDone: 0,
          stagedManifest: [], charterPaid: true, stalledCycles: 0,
        },
        {
          kind: "build", id: "b1", origin: "auto", factionId: pid, systemId: home,
          buildingType: "housing", levels: 1, workTotal: 20, workDone: 0,
        },
      ],
    });

    const data = getTrackerData();
    expect(data.building.map((b) => b.systemId)).toEqual([home]);
    expect(data.building[0].label).toContain("Housing");
    expect(data.colonising.map((c) => c.systemId)).toEqual([home]);

    // Each row's ETA is its own project's. Both draw the cap-4 slice from a pool that covers both,
    // so the build lands in 20/4 = 5 cycles and the colony in 60/4 = 15.
    expect(data.building[0].etaCycles).toBe(5);
    expect(data.colonising[0].etaCycles).toBe(15);
  });
});

describe("GET /api/game/player/tracker", () => {
  it("carries no Cache-Control beyond private, no-cache, so a New game cannot serve stale system ids", async () => {
    setWorld(seatWorld());
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
