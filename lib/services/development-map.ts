import { getWorld } from "@/lib/world/store";
import { buildingsBySystem } from "@/lib/services/world-index";
import { systemDevelopment } from "@/lib/engine/development";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import type { DevelopmentEntry } from "@/lib/types/game";

/**
 * Per-system development (0..1) for the development choropleth (all-systems bulk read). Assembles each
 * system's built base + physical substrate from the world rows and folds them through the pure
 * `systemDevelopment`. Tick-scoped — development changes as systems grow — so the route serves it
 * `no-cache` and the client invalidates it on the tick.
 */
export function getDevelopmentBySystem(): DevelopmentEntry[] {
  const buildings = buildingsBySystem();
  return getWorld().systems.map((s) => ({
    systemId: s.id,
    development: systemDevelopment({
      buildings: buildings.get(s.id) ?? {},
      population: s.population,
      slotCap: resourceVectorFromColumns(
        {
          slotGas: s.slotGas, slotMinerals: s.slotMinerals, slotOre: s.slotOre,
          slotBiomass: s.slotBiomass, slotArable: s.slotArable,
          slotWater: s.slotWater, slotRadioactive: s.slotRadioactive,
        },
        "slot",
      ),
      generalSpace: s.generalSpace,
      habitableSpace: s.habitableSpace,
    }),
  }));
}
