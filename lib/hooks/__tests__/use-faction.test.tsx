import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useFaction } from "../use-faction";
import { seedSlices } from "./store-fixture";
import type { FactionDetail } from "@/lib/services/factions";

const FACTION: FactionDetail = {
  id: "f1",
  name: "Meridian Combine",
  description: "",
  color: "#3b6ea5",
  governmentType: "federation",
  governmentName: "Republic",
  doctrine: "expansionist",
  doctrineName: "Expansionist",
  homeworldId: "sys-1",
  homeworldName: "Sol",
  territorySize: 3,
  status: "regional",
  isPlayer: true,
  doctrineDescription: "",
  governmentDescription: "",
  territory: [],
  relations: [],
  alliances: [],
  recentEvents: [],
};

describe("useFaction — genuinely absent factionId, never throws", () => {
  it("returns found:true with the faction record for a known id", () => {
    seedSlices({ factionDetail: { f1: FACTION } });
    const { result } = renderHook(() => useFaction("f1"));
    expect(result.current).toEqual({ found: true, faction: FACTION });
  });

  it("returns found:false for an id absent from the snapshot, never throws", () => {
    seedSlices({ factionDetail: { f1: FACTION } });
    expect(() => renderHook(() => useFaction("f-does-not-exist"))).not.toThrow();
    const { result } = renderHook(() => useFaction("f-does-not-exist"));
    expect(result.current).toEqual({ found: false });
  });
});
