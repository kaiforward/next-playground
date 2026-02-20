// Void's Gambit — Scoring engine
// Resolves manifests at game end: honest cards score printed value,
// surviving lies score declared value, caught cards score 0.

import type {
  ManifestEntry,
  ScoringBreakdown,
  GameResult,
  GameState,
  ResolvedCardDetail,
} from "./types";
import { isHonestDeclaration } from "./actions";

// ── Card resolution ─────────────────────────────────────────────

/** Determine the scored value of a single manifest entry. */
function resolveCardValue(entry: ManifestEntry): number {
  if (entry.caught) return 0;
  if (isHonestDeclaration(entry)) return entry.card.value;
  // Surviving lie: scores declared value
  return entry.declaration.value;
}

// ── Score calculation ───────────────────────────────────────────

export function calculateScore(
  manifest: ManifestEntry[],
  penalties: number,
): ScoringBreakdown {
  const cardDetails: ResolvedCardDetail[] = manifest.map((entry) => ({
    card: entry.card,
    declaration: entry.declaration,
    honest: isHonestDeclaration(entry),
    caught: entry.caught,
    scoredValue: resolveCardValue(entry),
    round: entry.round,
  }));

  const cardValues = cardDetails.reduce((sum, d) => sum + d.scoredValue, 0);

  return {
    cardValues,
    penalties,
    total: cardValues - penalties,
    cardDetails,
  };
}

// ── Winner determination ────────────────────────────────────────

export function determineWinner(state: GameState): GameResult {
  const playerScore = calculateScore(
    state.player.manifest,
    state.player.penalties,
  );
  const npcScore = calculateScore(state.npc.manifest, state.npc.penalties);

  let winner: "player" | "npc" | "tie";

  if (playerScore.total > npcScore.total) {
    winner = "player";
  } else if (npcScore.total > playerScore.total) {
    winner = "npc";
  } else {
    winner = "tie";
  }

  const wager = state.config.wager;
  const potWinnings = winner === "tie" ? wager : wager * 2;

  return { winner, playerScore, npcScore, potWinnings };
}
