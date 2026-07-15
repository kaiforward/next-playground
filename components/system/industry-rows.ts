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
}

/**
 * Per-resource deposit rows, joining the per-resource deposit summary (slots, yield) to the
 * per-building extractor readout (built count, in-use, output, health). A resource shared by
 * several goods (food + textiles → arable) sums their levels/working/output and takes the
 * worst contributor's health. Deposits arrive richest-cap-first (summariseDeposits).
 */
export function depositRows(
  deposits: SystemDepositSummary[],
  extractors: SystemIndustryReadout["buildings"],
  unrest: number,
  unrestThreshold: number,
): DepositRow[] {
  const byResource = new Map<ResourceType, { built: number; worked: number; output: number; health: IndustryHealth }>();
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
  }
  return deposits
    .filter((d) => d.slotCap > 0)
    .map((d) => {
      const agg = byResource.get(d.resource) ?? { built: 0, worked: 0, output: 0, health: "stable" as IndustryHealth };
      return { resource: d.resource, yieldMult: d.yieldMult, band: d.band, slotCap: d.slotCap, ...agg };
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
