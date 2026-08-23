import { QUALITY_BANDS } from "@/lib/constants/substrate-gen";
import type { QualityBand } from "@/lib/constants/substrate-gen";
import type { QualityBandId, ResourceType } from "@/lib/types/game";
import type { RNG } from "./universe-gen";

export function rollQualityBand(rng: RNG): { band: QualityBandId; multiplier: number } {
  const total = QUALITY_BANDS.reduce((s, b) => s + b.weight, 0);
  let roll = rng() * total;
  let chosen: QualityBand = QUALITY_BANDS[QUALITY_BANDS.length - 1];
  for (const b of QUALITY_BANDS) { roll -= b.weight; if (roll <= 0) { chosen = b; break; } }
  return { band: chosen.id, multiplier: chosen.min + rng() * (chosen.max - chosen.min) };
}

export function bandForMultiplier(mult: number): QualityBandId {
  for (const b of QUALITY_BANDS) if (mult <= b.max) return b.id;
  return QUALITY_BANDS[QUALITY_BANDS.length - 1].id;
}

const BAND_ADJECTIVE: Record<QualityBandId, string> = {
  poor: "Marginal", average: "Modest", good: "Rich", rich: "Bountiful",
};
const RESOURCE_NOUN: Record<ResourceType, string> = {
  gas: "gas pocket", minerals: "mineral seam", ore: "ore body", biomass: "biomass bloom",
  arable: "arable belt", water: "ice/water reserve", radioactive: "radioactive lode",
};
/** Generic, generated deposit name — band × resource. Replaces the v1 named-modifier catalog. */
export function depositDisplayName(resource: ResourceType, band: QualityBandId): string {
  return `${BAND_ADJECTIVE[band]} ${RESOURCE_NOUN[resource]}`;
}
