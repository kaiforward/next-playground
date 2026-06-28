import { RESOURCE_TYPES } from "@/lib/engine/resources";
import { bandForMultiplier, depositDisplayName } from "@/lib/engine/substrate-space";
import type { QualityBandId, ResourceType, ResourceVector } from "@/lib/types/game";

/** One body's deposit as a named physical feature — astrography flavour. */
export interface DepositFeature {
  resource: ResourceType;
  band: QualityBandId;
  /** Generated display name, e.g. "Rich ore body". */
  name: string;
}

/**
 * The deposits physically present on one body, as named features ordered
 * richest-first. This is the static intrinsic grade ("what is in the ground") —
 * distinct from the industry panel's worked-slot / effective-yield view. A
 * resource with no slots on the body is absent.
 */
export function bodyDepositFeatures(slots: ResourceVector, quality: ResourceVector): DepositFeature[] {
  return RESOURCE_TYPES.filter((r) => slots[r] > 0)
    .map((r) => {
      const band = bandForMultiplier(quality[r]);
      return { resource: r, band, name: depositDisplayName(r, band) };
    })
    .sort((a, b) => quality[b.resource] - quality[a.resource]);
}

