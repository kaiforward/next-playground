import type { BartenderTip } from "@/lib/engine/cantina/tips";
import type { PatronRumor } from "@/lib/engine/cantina/rumors";
import type { CantinaNpcType } from "@/lib/constants/cantina-npcs";

// ── Service return types ────────────────────────────────────────

export interface BartenderData {
  greeting: string;
  tips: BartenderTip[];
  visitCount: number;
}

export interface PatronData {
  rumors: PatronRumor[];
}

export type NpcVisitCounts = Partial<Record<CantinaNpcType, number>>;

export interface NpcVisitResult {
  npcType: CantinaNpcType;
  visits: number;
}

export type WagerOutcome = "win" | "loss" | "tie";

export interface WagerResult {
  ok: true;
  outcome: WagerOutcome;
  creditsChange: number;
  newBalance: number;
}

export interface WagerError {
  ok: false;
  error: string;
  status: number;
}

export interface WagerValidation {
  valid: boolean;
  currentBalance: number;
  error: string | null;
}
