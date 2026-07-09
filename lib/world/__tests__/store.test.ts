import { describe, it, expect, afterEach } from "vitest";
import { ServiceError } from "@/lib/services/errors";
import {
  clearWorld,
  getWorld,
  getWorldVersion,
  hasWorld,
  setWorld,
} from "@/lib/world/store";
import type { World } from "@/lib/world/types";

function fakeWorld(): World {
  return {
    meta: {
      seed: 42,
      systemCount: 0,
      mapSize: 0,
      currentTick: 0,
      startingSystemId: "s1",
    },
    regions: [],
    systems: [],
    bodies: [],
    buildings: [],
    constructionProjects: [],
    traits: [],
    connections: [],
    markets: [],
    factions: [],
    relations: [],
    alliancePacts: [],
    events: [],
    modifiers: [],
    ships: [],
    flowEvents: [],
    nextId: 1,
  };
}

describe("world store", () => {
  afterEach(() => {
    clearWorld();
  });

  it("has no world loaded initially", () => {
    expect(hasWorld()).toBe(false);
  });

  it("throws a 409 ServiceError from getWorld() when no world is loaded", () => {
    expect(() => getWorld()).toThrow(ServiceError);
    try {
      getWorld();
      expect.fail("expected getWorld() to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ServiceError);
      expect(err).toMatchObject({ status: 409 });
    }
  });

  it("returns the stored world after setWorld() and bumps the version", () => {
    const versionBefore = getWorldVersion();
    const world = fakeWorld();

    setWorld(world);

    expect(hasWorld()).toBe(true);
    expect(getWorld()).toBe(world);
    expect(getWorldVersion()).toBe(versionBefore + 1);
  });

  it("clears the stored world and bumps the version", () => {
    setWorld(fakeWorld());
    const versionAfterSet = getWorldVersion();

    clearWorld();

    expect(hasWorld()).toBe(false);
    expect(getWorldVersion()).toBe(versionAfterSet + 1);
    expect(() => getWorld()).toThrow(ServiceError);
  });
});
