import { GOODS } from "@/lib/constants/goods";
import type { EventPhaseDefinition } from "@/lib/constants/events";

/** Resolve a good key to its display name via the GOODS constant. */
function goodDisplayName(goodId: string): string {
  return GOODS[goodId]?.name ?? (goodId.charAt(0).toUpperCase() + goodId.slice(1));
}

/**
 * Derive a human-readable effect summary from a phase's modifiers.
 * Anchor shifts surface as "X demand up/down" (high demand = high price).
 * Returns e.g. "Food, Medicine demand up · Production slowed".
 */
export function summarizePhaseEffects(phase: EventPhaseDefinition): string {
  const parts: string[] = [];

  const demandUp: string[] = [];
  const demandDown: string[] = [];
  let productionChange: "up" | "down" | null = null;

  for (const mod of phase.modifiers) {
    const goodLabel = mod.goodId ? goodDisplayName(mod.goodId) : null;

    if (mod.type === "anchor_shift" && mod.parameter === "target_stock") {
      if (mod.value > 1) {
        if (goodLabel) demandUp.push(goodLabel);
        else parts.push("All demand up");
      } else if (mod.value < 1) {
        if (goodLabel) demandDown.push(goodLabel);
        else parts.push("All demand down");
      }
    } else if (mod.type === "rate_multiplier" && mod.parameter === "production_rate") {
      productionChange = mod.value > 1 ? "up" : "down";
    }
  }

  const hasAllDemandUp = parts.includes("All demand up");
  const hasAllDemandDown = parts.includes("All demand down");

  if (demandUp.length > 0 && !hasAllDemandUp) parts.push(`${demandUp.join(", ")} demand up`);
  if (demandDown.length > 0 && !hasAllDemandDown) parts.push(`${demandDown.join(", ")} demand down`);
  if (productionChange === "down") parts.push("Production slowed");
  if (productionChange === "up") parts.push("Production boosted");

  return parts.length > 0 ? parts.join(" · ") : "Minor market effects";
}
