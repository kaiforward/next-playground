import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { systemDevelopment, developmentRefs, type DevelopmentRefs } from "@/lib/engine/development";
import type { WorldSystem } from "@/lib/world/types";
import type { DevelopmentEntry } from "@/lib/types/game";

/**
 * The universe-wide development reference (the galaxy's biggest natural potential) from the world's
 * systems. Static substrate — habitable/general space and deposit-slot caps never change during play —
 * so it is a per-world constant recomputed cheaply per read. Exported so both the choropleth and its
 * test derive the same reference every `systemDevelopment` is measured against.
 */
export function developmentRefsForWorld(systems: WorldSystem[]): DevelopmentRefs {
  return developmentRefs(
    systems.map((s) => ({
      habitableSpace: s.habitableSpace,
      generalSpace: s.generalSpace,
      depositSlots:
        s.slotGas + s.slotMinerals + s.slotOre + s.slotBiomass + s.slotArable + s.slotWater + s.slotRadioactive,
    })),
  );
}

/**
 * Per-system development (0..1) for the development choropleth (all-systems bulk read). Folds each
 * system's built base + resident population + habitable land through the pure `systemDevelopment`,
 * measured against the universe-wide reference (the galaxy's biggest natural potential). Tick-scoped —
 * development changes as systems grow — so the route serves it `no-cache` and the client invalidates it
 * on the tick.
 */
export function getDevelopmentBySystem(): DevelopmentEntry[] {
  const buildings = buildingsBySystem();
  const systems = getWorld().systems;
  const refs = developmentRefsForWorld(systems);
  return systems.map((s) => ({
    systemId: s.id,
    development: systemDevelopment(
      {
        buildings: buildings.get(s.id) ?? {},
        population: s.population,
        habitableSpace: s.habitableSpace,
      },
      refs,
    ),
  }));
}
