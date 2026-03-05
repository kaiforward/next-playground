import { GOODS } from "@/lib/constants/goods";
import type { EventPhaseDefinition } from "@/lib/constants/events";

/** Resolve a good key to its display name via the GOODS constant. */
function goodDisplayName(goodId: string): string {
  return GOODS[goodId]?.name ?? (goodId.charAt(0).toUpperCase() + goodId.slice(1));
}

/**
 * Derive a human-readable effect summary from a phase's modifiers.
 * Returns phrases like "Food, Medicine demand up · Production slowed · Danger increased".
 */
export function summarizePhaseEffects(phase: EventPhaseDefinition): string {
  const parts: string[] = [];

  const demandUp: string[] = [];
  const demandDown: string[] = [];
  const supplyDown: string[] = [];
  const supplyUp: string[] = [];
  let productionChange: "up" | "down" | null = null;
  let hasDanger = false;

  for (const mod of phase.modifiers) {
    if (mod.domain === "navigation") {
      hasDanger = true;
      continue;
    }

    const goodLabel = mod.goodId ? goodDisplayName(mod.goodId) : null;

    if (mod.type === "equilibrium_shift") {
      if (mod.parameter === "demand_target") {
        if (mod.value > 1) {
          if (goodLabel) demandUp.push(goodLabel);
          else parts.push("All demand up");
        } else if (mod.value < 1) {
          if (goodLabel) demandDown.push(goodLabel);
          else parts.push("All demand down");
        }
      } else if (mod.parameter === "supply_target") {
        if (mod.value < 1) {
          if (goodLabel) supplyDown.push(goodLabel);
          else parts.push("All supply reduced");
        } else if (mod.value > 1) {
          if (goodLabel) supplyUp.push(goodLabel);
          else parts.push("All supply increased");
        }
      }
    } else if (mod.type === "rate_multiplier" && mod.parameter === "production_rate") {
      productionChange = mod.value > 1 ? "up" : "down";
    }
  }

  const hasAllDemandUp = parts.includes("All demand up");
  const hasAllDemandDown = parts.includes("All demand down");
  const hasAllSupplyReduced = parts.includes("All supply reduced");
  const hasAllSupplyIncreased = parts.includes("All supply increased");

  if (demandUp.length > 0 && !hasAllDemandUp) parts.push(`${demandUp.join(", ")} demand up`);
  if (demandDown.length > 0 && !hasAllDemandDown) parts.push(`${demandDown.join(", ")} demand down`);
  if (supplyUp.length > 0 && !hasAllSupplyIncreased) parts.push(`${supplyUp.join(", ")} supply up`);
  if (supplyDown.length > 0 && !hasAllSupplyReduced) parts.push(`${supplyDown.join(", ")} supply down`);
  if (productionChange === "down") parts.push("Production slowed");
  if (productionChange === "up") parts.push("Production boosted");
  if (hasDanger) parts.push("Danger increased");

  return parts.length > 0 ? parts.join(" · ") : "Minor market effects";
}
