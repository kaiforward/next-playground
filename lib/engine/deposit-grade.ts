/**
 * Deposit grade — the per-resource effective yield multiplier of a system's deposit field, a pure
 * property of the ground: the capacity-weighted mean quality of a resource's slots across the system's
 * bodies. It scales tier-0 extractor output (`industry.ts`) and feeds the economy-type label.
 *
 * Fill-independent by construction: it is the grade a fully-worked field realises, NOT a function of how
 * many extractors happen to be placed. This is what lets the substrate carry a stable deposit grade
 * regardless of how (or whether) a system is developed — a colony that later builds extractors into the
 * field realises this same average grade.
 */
import type { ResourceType, ResourceVector } from "@/lib/types/game";
import { RESOURCE_TYPES, unitResourceVector } from "@/lib/engine/resources";

/** Minimal per-body view the grade needs: deposit slots + quality band, per resource. */
export interface GradedBody {
  slots: ResourceVector;
  quality: ResourceVector;
}

/**
 * Capacity-weighted mean deposit quality for one resource: Σ(slots·quality) / Σ slots over the bodies
 * that host the resource. Returns 1.0 (a neutral multiplier) where the system has no slots for it.
 */
export function depositGrade(bodies: GradedBody[], resource: ResourceType): number {
  let weighted = 0;
  let total = 0;
  for (const b of bodies) {
    const s = b.slots[resource];
    if (s <= 0) continue;
    weighted += s * b.quality[resource];
    total += s;
  }
  return total > 0 ? weighted / total : 1;
}

/** Per-resource deposit-grade vector (see `depositGrade`). */
export function depositGradeVector(bodies: GradedBody[]): ResourceVector {
  const out = unitResourceVector();
  for (const r of RESOURCE_TYPES) out[r] = depositGrade(bodies, r);
  return out;
}
