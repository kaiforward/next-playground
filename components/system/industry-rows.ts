/**
 * Pure view-model for the Industry tab's tables — per-resource deposit rows and the
 * general-land partition. No DOM, no React. Row health is grounded in the decay engine
 * (`buildingHealth`), so a row's indicator can never contradict what actually decays.
 */
import type { ResourceType, QualityBandId } from "@/lib/types/game";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import { buildingHealth } from "@/lib/engine/industry";
import type { SystemDepositSummary, SystemIndustryReadout, SubstrateSpace, IndustryHealth } from "@/lib/engine/industry";

/** Severity ordering for the worst-of-contributors aggregation (collapsing is worst). */
const SEVERITY: Record<IndustryHealth, number> = { stable: 0, contracting: 1, collapsing: 2 };

/** One catalog extractor type's contribution to a shared deposit — the per-type breakdown under a
 *  resource worked by more than one building type. Zeroed with health "stable" when nothing's built. */
export interface DepositTypeRow {
  buildingType: string;
  built: number;
  worked: number;
  output: number;
  health: IndustryHealth;
}

export interface DepositRow {
  resource: ResourceType;
  yieldMult: number;
  band: QualityBandId;
  /** Total deposit slots — the capacity ceiling. */
  slotCap: number;
  /** Extractor levels built on this resource's slots. */
  built: number;
  /** In-use working across the built levels (Σ extractor `used` — the decay-relevant amount). */
  worked: number;
  /** Real output this cycle across the resource's extractors. */
  output: number;
  /** Worst health across the resource's extractors — drives the row indicator. */
  health: IndustryHealth;
  /**
   * One entry per catalog extractor type on this resource (BUILDING_TYPES[t].resource === resource),
   * in catalog order. A resource worked by a single type carries exactly one entry; a resource shared
   * by several types (e.g. arable → food + textiles) surfaces each type separately — including a type
   * with nothing built yet — so the player can see it exists and quick-add it.
   */
  types: DepositTypeRow[];
}

/**
 * Per-resource deposit rows, joining the per-resource deposit summary (slots, yield) to the
 * per-building extractor readout (built count, in-use, output, health). A resource shared by
 * several goods (food + textiles → arable) sums their levels/working/output for the aggregate
 * fields and takes the worst contributor's health, while `types` keeps each contributing type's
 * own numbers so the shared pool doesn't hide how much of each good exists. Deposits arrive
 * richest-cap-first (summariseDeposits).
 */
export function depositRows(
  deposits: SystemDepositSummary[],
  extractors: SystemIndustryReadout["buildings"],
  unrest: number,
  unrestThreshold: number,
): DepositRow[] {
  const byResource = new Map<ResourceType, { built: number; worked: number; output: number; health: IndustryHealth }>();
  const byType = new Map<string, DepositTypeRow>();
  for (const b of extractors) {
    const resource = BUILDING_TYPES[b.buildingType]?.resource;
    if (!resource) continue;
    const h = buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: unrestThreshold });
    const acc = byResource.get(resource) ?? { built: 0, worked: 0, output: 0, health: "stable" as IndustryHealth };
    acc.built += b.count;
    acc.worked += b.used;
    acc.output += b.output ?? 0;
    if (SEVERITY[h] > SEVERITY[acc.health]) acc.health = h;
    byResource.set(resource, acc);
    byType.set(b.buildingType, { buildingType: b.buildingType, built: b.count, worked: b.used, output: b.output ?? 0, health: h });
  }
  return deposits
    .filter((d) => d.slotCap > 0)
    .map((d) => {
      const agg = byResource.get(d.resource) ?? { built: 0, worked: 0, output: 0, health: "stable" as IndustryHealth };
      const types = Object.keys(BUILDING_TYPES)
        .filter((t) => BUILDING_TYPES[t].resource === d.resource)
        .map((t) => byType.get(t) ?? { buildingType: t, built: 0, worked: 0, output: 0, health: "stable" as IndustryHealth });
      return { resource: d.resource, yieldMult: d.yieldMult, band: d.band, slotCap: d.slotCap, ...agg, types };
    });
}

/** The general-land partition, with the habitable subset broken out so housing headroom reads in units. */
export interface GeneralLand {
  /** Land under population centres (draws on the habitable subset). */
  housing: number;
  /** Land under factories / academies / complexes (non-housing general use). */
  factory: number;
  /** Free land still inside the habitable cap — housing can grow here. */
  habitableFree: number;
  /** Free land beyond the habitable cap — factories only. */
  factoryFree: number;
  /** Total general land. */
  general: number;
  /** Total habitable land — the population-centre ceiling. */
  habitable: number;
}

/**
 * Split general land into housing / factory footprints + the free tail, breaking the free tail into
 * habitable-free (housing can still grow) vs factory-only-free (beyond the habitable cap). Housing +
 * factory + habitableFree + factoryFree always sum to `general`.
 */
export function generalLand(space: SubstrateSpace): GeneralLand {
  const housing = Math.max(0, space.habitableUsed);
  const factory = Math.max(0, space.generalUsed - space.habitableUsed);
  const free = Math.max(0, space.general - space.generalUsed);
  const habitableHeadroom = Math.max(0, space.habitable - space.habitableUsed);
  const habitableFree = Math.min(free, habitableHeadroom);
  const factoryFree = Math.max(0, free - habitableFree);
  return { housing, factory, habitableFree, factoryFree, general: space.general, habitable: space.habitable };
}
