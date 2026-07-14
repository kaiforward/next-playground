import { describe, it, expect, afterEach } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import { getSystemPopulation } from "@/lib/services/system-population";
import { getSystemVitals } from "@/lib/services/system-vitals";
import { getSystemIndustry } from "@/lib/services/universe";
import { getSystemLogistics } from "@/lib/services/trade-flow";
import { getMarket } from "@/lib/services/market";

afterEach(() => {
  clearWorld();
});

describe("system-detail services gate on developed control", () => {
  it("returns the inert shape for a non-developed system", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    setWorld(world);
    const undeveloped = world.systems.find((s) => s.control !== "developed")!;

    expect(getSystemPopulation(undeveloped.id)).toEqual({ visibility: "unknown" });
    expect(getSystemVitals(undeveloped.id)).toEqual({ visibility: "unknown" });
    expect(getSystemIndustry(undeveloped.id)).toEqual({ visibility: "unknown" });
    expect(getSystemLogistics(undeveloped.id)).toEqual({ visibility: "unknown" });
    expect(getMarket(undeveloped.id)).toEqual({ stationId: undeveloped.id, entries: [] });
  });

  it("returns visible data for a developed homeworld", () => {
    const world = generateWorld({ systemCount: 60, seed: 7 });
    setWorld(world);
    const developed = world.systems.find((s) => s.control === "developed")!;

    expect(getSystemPopulation(developed.id).visibility).toBe("visible");
    expect(getSystemVitals(developed.id).visibility).toBe("visible");
    expect(getSystemIndustry(developed.id).visibility).toBe("visible");
  });
});
