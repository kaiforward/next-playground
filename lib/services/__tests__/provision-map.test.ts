import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getProvisionBySystem } from "@/lib/services/provision-map";
import type { World, WorldSystem } from "@/lib/world/types";

let world: World;

beforeEach(() => {
  world = generateWorld({ systemCount: 20, seed: 7 });
  setWorld(world);
});

afterEach(() => {
  clearWorld();
});

describe("getProvisionBySystem", () => {
  it("returns one entry per assessed system only, excluding a never-assessed system", () => {
    const [a, b, c] = world.systems;
    const systems: WorldSystem[] = world.systems.map((s) => {
      if (s.id === a.id) return { ...s, provision: 0.95, supplyBand: "supplied" };
      if (s.id === b.id) return { ...s, provision: 0.5, supplyBand: "rationing" };
      if (s.id === c.id) return { ...s, provision: undefined, supplyBand: undefined };
      return s;
    });
    setWorld({ ...world, systems });

    const entries = getProvisionBySystem();
    expect(entries.some((e) => e.systemId === a.id)).toBe(true);
    expect(entries.some((e) => e.systemId === b.id)).toBe(true);
    expect(entries.some((e) => e.systemId === c.id)).toBe(false);
  });

  it("carries the persisted provision and nothing else — the band is not on the map payload", () => {
    const [a] = world.systems;
    const systems: WorldSystem[] = world.systems.map((s) =>
      s.id === a.id ? { ...s, provision: 0.62, supplyBand: "famine" } : s,
    );
    setWorld({ ...world, systems });

    const entry = getProvisionBySystem().find((e) => e.systemId === a.id)!;
    // A famine world reading mid Provision — the survival punch-through — is carried at its true
    // number, and the band it is in stays off this payload: the map steps its own fill at the band
    // edges, and famine (which owns no span of the axis) is the per-system read's signal, not this one.
    expect(entry).toEqual({ systemId: a.id, provision: 0.62 });
  });

  it("excludes a partially-written system — provision set but band absent still reads unassessed", () => {
    const [a] = world.systems;
    const systems: WorldSystem[] = world.systems.map((s) =>
      s.id === a.id ? { ...s, provision: 0.8, supplyBand: undefined } : s,
    );
    setWorld({ ...world, systems });

    expect(getProvisionBySystem().some((e) => e.systemId === a.id)).toBe(false);
  });

  it("excludes the other partial write — band set but provision absent", () => {
    const [a] = world.systems;
    const systems: WorldSystem[] = world.systems.map((s) =>
      s.id === a.id ? { ...s, provision: undefined, supplyBand: "supplied" } : s,
    );
    setWorld({ ...world, systems });

    expect(getProvisionBySystem().some((e) => e.systemId === a.id)).toBe(false);
  });
});
