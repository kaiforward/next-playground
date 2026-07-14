/**
 * Pure view-model for the Industry tab's deposit/space chip breakdown — the
 * four-state chip grammar shared by deposits and production. No DOM, no React:
 * turns the industry readout into chip descriptors the panel renders, so the
 * grammar is unit-tested independent of markup.
 *
 * One grammar, four states:
 *   - staffed  → built & working; `fill` ∈ [0,1] is the fractional working level
 *   - idle     → built but wholly unstaffed (red) — wasted, decaying capacity
 *   - unbuilt  → buildable potential (dashed) — a free deposit slot, or the
 *                trailing "room to build" chip for unbounded general-space pools
 */
import type { ResourceType, QualityBandId } from "@/lib/types/game";
import { BUILDING_TYPES } from "@/lib/constants/industry";
import type { SystemDepositSummary, SystemIndustryReadout, SubstrateSpace } from "@/lib/engine/industry";

export type ChipKind = "staffed" | "idle" | "unbuilt";

/** One chip in a chip bar. `fill` ∈ [0,1] is the fractional working level — meaningful only for `staffed`. */
export interface Chip {
  kind: ChipKind;
  fill: number;
}

/**
 * Chips across `cap` slots. Slots `[0, built)` are built — each filled by the
 * waterfall `clamp(effective − i, 0, 1)` (a copper partial), or `idle` (red) when
 * that built slot receives essentially zero working. Slots `[built, cap)` are
 * `unbuilt` (dashed). With `addChip`, append one trailing `unbuilt` chip — the
 * "room to build" affordance for unbounded (general-space) pools.
 *
 * `cap`/`built` are treated as whole slots (rounded up so a present-but-fractional
 * structure — e.g. a partial specialisation complex — still shows one chip).
 */
export function chipStates(cap: number, built: number, effective: number, addChip = false): Chip[] {
  const slots = Math.max(0, Math.ceil(cap));
  const builtSlots = Math.max(0, Math.min(slots, Math.ceil(built)));
  const chips: Chip[] = [];
  for (let i = 0; i < slots; i++) {
    if (i >= builtSlots) {
      chips.push({ kind: "unbuilt", fill: 0 });
      continue;
    }
    const s = Math.max(0, Math.min(1, effective - i));
    chips.push(s > 0.005 ? { kind: "staffed", fill: s } : { kind: "idle", fill: 0 });
  }
  if (addChip) chips.push({ kind: "unbuilt", fill: 0 });
  return chips;
}

/** One deposit row — a resource's slot fill: bounded chips (worked / built-idle / unbuilt slots). */
export interface DepositChipRow {
  resource: ResourceType;
  /** Effective yield multiplier the worked slots deliver. */
  yieldMult: number;
  /** Quality band of the yield — drives the row's gold-when-rich yield colour. */
  band: QualityBandId;
  /** Total deposit slots (the chip count). */
  slotCap: number;
  /** Slots with an extractor built on them. */
  built: number;
  /** In-use working across the built slots (Σ extractor `used`, fractional). */
  worked: number;
  /** Real output this cycle across the resource's extractors. */
  output: number;
  chips: Chip[];
}

/**
 * Per-resource deposit chip rows, joining the per-resource deposit summary (slot
 * cap, built count, yield) to the per-building extractor readout (in-use + output).
 * A resource shared by several goods (food + textiles → arable) sums their working
 * and output onto one row. Deposits arrive richest-cap-first (summariseDeposits).
 */
export function depositChipRows(
  deposits: SystemDepositSummary[],
  extractors: SystemIndustryReadout["buildings"],
): DepositChipRow[] {
  const byResource = new Map<ResourceType, { worked: number; output: number }>();
  for (const b of extractors) {
    const resource = BUILDING_TYPES[b.buildingType]?.resource;
    if (!resource) continue;
    const acc = byResource.get(resource) ?? { worked: 0, output: 0 };
    acc.worked += b.used;
    acc.output += b.output ?? 0;
    byResource.set(resource, acc);
  }
  return deposits
    .filter((d) => d.slotCap > 0)
    .map((d) => {
      const agg = byResource.get(d.resource) ?? { worked: 0, output: 0 };
      return {
        resource: d.resource,
        yieldMult: d.yieldMult,
        band: d.band,
        slotCap: d.slotCap,
        // deposit.worked is the *built* slot count (extractorsByResource), not the
        // working amount — the fractional working comes from Σ extractor `used`.
        built: d.worked,
        worked: agg.worked,
        output: agg.output,
        chips: chipStates(d.slotCap, d.worked, agg.worked, false),
      };
    });
}

/** One segment of the general-land magnitude bar. */
export interface MagSegment {
  key: "housing" | "factory" | "free";
  /** Raw land amount. */
  value: number;
  /** Share of total general land in [0,1]. */
  fraction: number;
}

/**
 * The general-land aggregate as housing / factory / free segments (continuous
 * capacity, so a magnitude bar, not chips). Factory = every non-housing general
 * structure (factories, academies, complexes); free = unbuilt general headroom.
 */
export function generalLandSegments(space: SubstrateSpace): MagSegment[] {
  const housing = Math.max(0, space.habitableUsed);
  const factory = Math.max(0, space.generalUsed - space.habitableUsed);
  const free = Math.max(0, space.general - space.generalUsed);
  const total = space.general > 0 ? space.general : 1;
  return [
    { key: "housing", value: housing, fraction: housing / total },
    { key: "factory", value: factory, fraction: factory / total },
    { key: "free", value: free, fraction: free / total },
  ];
}
