// ── Danger bucketing ───────────────────────────────────────────

export function getDangerInfo(rawDanger: number): { label: string; color: "green" | "amber" | "red" } {
  if (rawDanger <= 0) return { label: "None", color: "green" };
  if (rawDanger < 0.1) return { label: "Low", color: "green" };
  if (rawDanger < 0.2) return { label: "Moderate", color: "amber" };
  if (rawDanger < 0.35) return { label: "High", color: "red" };
  return { label: "Extreme", color: "red" };
}
