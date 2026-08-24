/**
 * Worked-deposit fill order — per-resource realised extraction yield as the mean of ground
 * values over the worked prefix, rather than the all-unlocked-bodies pool. A slot is one
 * authored deposit of a resource on one unlocked body; a body with `counts[r] = 3` contributes
 * three identical slots, each carrying that body's quality and its archetype's
 * `extractionModifier`. Slots for `(system, r)` sort by ground value (`quality * modifier`)
 * descending, ties broken by the body's position in the input array (generation order).
 *
 * The worked prefix is the first `n` slots of that order, where `n` is the shared built
 * extractor-level count for the resource (`extractorsOnResource`). The realised multiplier is
 * the mean of ground values over the prefix — the `eff` column keeps its authored meaning
 * (worked-prefix mean of `extractionModifier`) and `yieldMult` is derived as
 * `realised / eff` so the read-site product `eff * yieldMult` equals the mean of ground values
 * EXACTLY, never a product-of-means approximation.
 *
 * Pure, zero I/O. A slot's ground value is exact and per-body; the fold's job is choosing which
 * slots are "worked" (the first `n` by ground value) and folding only those.
 */
import type { BodyArchetypeId, ResourceType, ResourceVector } from "@/lib/types/game";
import { BODY_ARCHETYPES } from "@/lib/constants/bodies";
import { extractorsOnResource } from "@/lib/engine/directed-build";
import { RESOURCE_TYPES, unitResourceVector } from "@/lib/engine/resources";

/** Minimal per-body view the fold needs: archetype (for modifier + lock) plus counts/quality. */
export interface SlottedBody {
  bodyType: BodyArchetypeId;
  counts: ResourceVector;
  quality: ResourceVector;
}

/** One deposit slot in the fill order: the body it belongs to, and its ground-value inputs. */
export interface DepositSlot {
  bodyIndex: number;
  groundValue: number;
  modifier: number;
  quality: number;
}

/**
 * The fill order for `(bodies, r)`: one entry per unlocked deposit slot, sorted by ground value
 * (`quality * extractionModifier`) descending, ties broken by `bodyIndex` ascending (the input
 * array's own order — generation order, stable and save-deterministic). Tech-locked archetype
 * classes contribute no slots at all.
 */
export function depositSlotOrder(bodies: SlottedBody[], r: ResourceType): DepositSlot[] {
  const slots: DepositSlot[] = [];
  bodies.forEach((b, bodyIndex) => {
    const archetype = BODY_ARCHETYPES[b.bodyType];
    if (archetype.techLocked) return;
    const count = b.counts[r];
    if (count <= 0) return;
    const modifier = archetype.extractionModifier;
    const quality = b.quality[r];
    const groundValue = quality * modifier;
    for (let i = 0; i < count; i++) {
      slots.push({ bodyIndex, groundValue, modifier, quality });
    }
  });
  // Stable sort by ground value descending; ties keep their relative (bodyIndex-ascending)
  // input order because Array#sort is a stable sort and slots were pushed in bodyIndex order.
  slots.sort((a, b) => b.groundValue - a.groundValue);
  return slots;
}

/**
 * The worked-prefix fold: `eff` is the mean modifier over the prefix (its authored meaning,
 * preserved), `realised` is the mean ground value over the prefix, and `yieldMult` is derived
 * as `realised / eff` so `eff * yieldMult` equals `realised` exactly.
 *
 * Edge behaviour:
 *  - no slots at all: neutral 1.0 on every output ("no deposits of r" — the shared
 *    countWeightedMean convention).
 *  - `n = 0` with slots present: reads the FIRST slot (best ground) on every output — a seed
 *    extractor would realise the best deposit, not a mean of nothing.
 *  - `n >= slots.length`: clamps at the all-slots mean (cannot arise through play; the build
 *    cap enforces n <= deposit count, defensive for corrupted saves).
 */
export function workedYieldFold(
  slots: DepositSlot[], n: number,
): { eff: number; yieldMult: number; realised: number } {
  if (slots.length === 0) return { eff: 1, yieldMult: 1, realised: 1 };

  const prefixLength = n <= 0 ? 1 : Math.min(n, slots.length);
  let modifierSum = 0;
  let groundSum = 0;
  for (let i = 0; i < prefixLength; i++) {
    modifierSum += slots[i].modifier;
    groundSum += slots[i].groundValue;
  }
  const eff = modifierSum / prefixLength;
  const realised = groundSum / prefixLength;
  // eff is a mean of modifiers in (0, 1], so it is never 0 here — no NaN/Infinity guard needed.
  const yieldMult = realised / eff;
  return { eff, yieldMult, realised };
}

/**
 * The `(n+1)`th slot in the order — the ground the next extractor built on this resource would
 * work. `null` once every slot is already worked (`n >= slots.length`), including when there are
 * no slots at all.
 */
export function marginalSlot(slots: DepositSlot[], n: number): DepositSlot | null {
  const index = Math.max(0, n);
  return index < slots.length ? slots[index] : null;
}

/**
 * Per-resource `{ eff, yieldMult }` vectors for a system's bodies, with `n` per resource read
 * from `extractorsOnResource` (the shared built-level count across every tier-0 good drawing on
 * that resource). An empty body list reads neutral 1.0 vectors on every resource, never NaN.
 */
export function workedYieldVectors(
  bodies: SlottedBody[], buildings: Record<string, number>,
): { eff: ResourceVector; yieldMult: ResourceVector } {
  const eff = unitResourceVector();
  const yieldMult = unitResourceVector();
  for (const r of RESOURCE_TYPES) {
    const slots = depositSlotOrder(bodies, r);
    const n = extractorsOnResource(buildings, r);
    const fold = workedYieldFold(slots, n);
    eff[r] = fold.eff;
    yieldMult[r] = fold.yieldMult;
  }
  return { eff, yieldMult };
}

/** Per-body, per-resource worked/total slot counts — the Astrography body-card read. */
export type WorkedByBody = Record<number, Record<ResourceType, { worked: number; total: number }>>;

/**
 * A fresh all-zero worked/total entry for every resource type — built by iterating
 * `RESOURCE_TYPES` so every key is genuinely present, no cast needed to satisfy the exact
 * `Record<ResourceType, ...>` shape (a string-indexed record is assignable to it once every key
 * is populated).
 */
function neutralWorkedEntry(): Record<ResourceType, { worked: number; total: number }> {
  const entry: Record<string, { worked: number; total: number }> = {};
  for (const r of RESOURCE_TYPES) entry[r] = { worked: 0, total: 0 };
  return entry;
}

/**
 * Per body, per resource: how many of its deposit slots are inside the worked prefix versus its
 * total slot count. `n` per resource is read from `extractorsOnResource`, same as
 * `workedYieldVectors`. An empty body list returns an empty map.
 */
export function workedByBody(bodies: SlottedBody[], buildings: Record<string, number>): WorkedByBody {
  const result: WorkedByBody = {};
  bodies.forEach((_, bodyIndex) => {
    result[bodyIndex] = neutralWorkedEntry();
  });

  for (const r of RESOURCE_TYPES) {
    const slots = depositSlotOrder(bodies, r);
    if (slots.length === 0) continue;
    const n = extractorsOnResource(buildings, r);
    const workedCount = n <= 0 ? 0 : Math.min(n, slots.length);
    slots.forEach((slot, i) => {
      const entry = result[slot.bodyIndex][r];
      entry.total += 1;
      if (i < workedCount) entry.worked += 1;
    });
  }
  return result;
}
