/**
 * Ledger placement for a system's in-flight BUILD projects — each ghost row lands in the group its
 * building will join (extractors on the deposit table via their resource; everything else under its
 * Housing / Academies / Specialisation / Production / Support heading), so the Industry tab reads
 * "have N, M more coming" in place. Colony rows are excluded: a forming colony is the undeveloped
 * surface's content, not a ledger entry.
 */
import type { ConstructionProjectRow } from "@/lib/engine/construction-readout";
import {
  BUILDING_TYPES, HOUSING_TYPE, COMPLEX_TYPES, SUPPORT_TYPES, ACADEMY_TYPES,
} from "@/lib/constants/industry";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";

export type GhostGroup = "deposit" | "Housing" | "Academies" | "Specialisation" | "Production" | "Support";

export interface GhostRow {
  projectId: string;
  buildingType: string;
  label: string;
  levels: number;
  origin: "auto" | "player";
  progress: number;
  etaPulses: number | null;
  /** deposit ghosts carry the resource their extractor sits on. */
  resource?: string;
}

function groupFor(buildingType: string): { group: GhostGroup; resource?: string } | null {
  const resource = BUILDING_TYPES[buildingType]?.resource;
  if (GOOD_TIER_BY_KEY[buildingType] === 0 && resource !== undefined) return { group: "deposit", resource };
  if (buildingType === HOUSING_TYPE) return { group: "Housing" };
  if (COMPLEX_TYPES.includes(buildingType)) return { group: "Specialisation" };
  if (SUPPORT_TYPES.includes(buildingType)) return { group: "Support" };
  if (ACADEMY_TYPES.includes(buildingType)) return { group: "Academies" };
  if ((GOOD_TIER_BY_KEY[buildingType] ?? 0) >= 1) return { group: "Production" };
  return null;
}

/** Split a system's in-flight BUILD rows into ledger destinations. Colony rows are excluded
 *  (they render on the undeveloped surface, Task 9). */
export function classifyGhosts(rows: ConstructionProjectRow[]): Map<GhostGroup, GhostRow[]> {
  const out = new Map<GhostGroup, GhostRow[]>();
  for (const row of rows) {
    if (row.kind !== "build") continue;
    const placed = groupFor(row.buildingType);
    if (!placed) continue;
    const list = out.get(placed.group) ?? [];
    list.push({
      projectId: row.id,
      buildingType: row.buildingType,
      label: row.buildingLabel,
      levels: row.levels,
      origin: row.origin,
      progress: row.progress,
      etaPulses: row.etaPulses,
      resource: placed.resource,
    });
    out.set(placed.group, list);
  }
  return out;
}
