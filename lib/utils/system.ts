import type { EconomyType } from "@/lib/types/game";

// ── Population derivation ──────────────────────────────────────

const ECONOMY_POP_BASE: Record<EconomyType, number> = {
  core: 3, industrial: 2, tech: 2, refinery: 1, agricultural: 1, extraction: 0,
};
const POP_LABELS = ["Outpost", "Sparse", "Moderate", "Populated", "Dense"] as const;

export function getPopulationLabel(economyType: EconomyType, traitCount: number): string {
  let tier = ECONOMY_POP_BASE[economyType];
  if (traitCount >= 3) tier += 1;
  return POP_LABELS[Math.min(Math.max(tier, 0), 4)];
}

// ── Danger bucketing ───────────────────────────────────────────

export function getDangerInfo(rawDanger: number): { label: string; color: "green" | "amber" | "red" } {
  if (rawDanger <= 0) return { label: "None", color: "green" };
  if (rawDanger < 0.1) return { label: "Low", color: "green" };
  if (rawDanger < 0.2) return { label: "Moderate", color: "amber" };
  if (rawDanger < 0.35) return { label: "High", color: "red" };
  return { label: "Extreme", color: "red" };
}
