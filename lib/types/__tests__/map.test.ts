import { describe, it, expect } from "vitest";
import { isMapMode, isValueMapMode, isFactionInteractiveMode, settlementMarkFor, MAP_MODES } from "@/lib/types/map";

describe("MapMode", () => {
  it("includes the territory modes in the mode set and ordering", () => {
    expect(MAP_MODES).toEqual([
      "political", "regions", "stability", "population", "development", "migration", "provision", "lanes", "none",
    ]);
    expect(isMapMode("political")).toBe(true);
    expect(isMapMode("regions")).toBe(true);
    expect(isMapMode("stability")).toBe(true);
    expect(isMapMode("population")).toBe(true);
    expect(isMapMode("development")).toBe(true);
    expect(isMapMode("migration")).toBe(true);
    expect(isMapMode("provision")).toBe(true);
    expect(isMapMode("lanes")).toBe(true);
    expect(isMapMode("none")).toBe(true);
  });
  it("rejects unknown modes", () => {
    expect(isMapMode("bogus")).toBe(false);
    expect(isMapMode("prosperity")).toBe(false);
  });
});

describe("isValueMapMode", () => {
  it("is true only for the value-choropleth modes", () => {
    expect(isValueMapMode("population")).toBe(true);
    expect(isValueMapMode("stability")).toBe(true);
    expect(isValueMapMode("development")).toBe(true);
    expect(isValueMapMode("migration")).toBe(true);
    expect(isValueMapMode("provision")).toBe(true);
    expect(isValueMapMode("lanes")).toBe(true);
  });
  it("is false for the topology / off modes", () => {
    expect(isValueMapMode("political")).toBe(false);
    expect(isValueMapMode("regions")).toBe(false);
    expect(isValueMapMode("none")).toBe(false);
  });
});

describe("isFactionInteractiveMode", () => {
  it("is true for the modes that show faction territory (political + the value modes)", () => {
    // Political opens the faction panel; the value modes also re-scope the gradient to the faction.
    expect(isFactionInteractiveMode("political")).toBe(true);
    expect(isFactionInteractiveMode("population")).toBe(true);
    expect(isFactionInteractiveMode("stability")).toBe(true);
    expect(isFactionInteractiveMode("development")).toBe(true);
    expect(isFactionInteractiveMode("migration")).toBe(true);
    expect(isFactionInteractiveMode("provision")).toBe(true);
  });
  it("is false for modes with no faction territory (a zoomed-out click falls through to the system)", () => {
    expect(isFactionInteractiveMode("regions")).toBe(false);
    expect(isFactionInteractiveMode("none")).toBe(false);
  });
});

describe("settlementMarkFor", () => {
  // `factionId` defaults only when ABSENT — an explicit null (unclaimed) must survive, so no `??`.
  const own = (o: { factionId?: string | null; developed?: boolean; forming?: boolean }) => ({
    factionId: o.factionId === undefined ? "player" : o.factionId,
    developed: o.developed ?? false,
    forming: o.forming ?? false,
  });

  it("maps a player system's control tier onto the three marks", () => {
    expect(settlementMarkFor(own({}), "player")).toBe("controlled");
    expect(settlementMarkFor(own({ forming: true }), "player")).toBe("forming");
    expect(settlementMarkFor(own({ developed: true }), "player")).toBe("developed");
  });

  it("marks no system that is not the player's — foreign, unclaimed, ownership not yet loaded, or no seat", () => {
    expect(settlementMarkFor(own({ factionId: "rival", developed: true }), "player")).toBeNull();
    expect(settlementMarkFor(own({ factionId: null }), "player")).toBeNull();
    expect(settlementMarkFor(undefined, "player")).toBeNull();
    expect(settlementMarkFor(own({ developed: true }), null)).toBeNull();
  });

  it("lets developed win over a stale forming pairing", () => {
    // The two never co-occur in real data (a forming site is `controlled`), but the tiebreak is
    // pinned so a transient payload can't flash a developed system back to a pulsing mark.
    expect(settlementMarkFor(own({ developed: true, forming: true }), "player")).toBe("developed");
  });
});
