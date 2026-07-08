import type { Doctrine, GovernmentType } from "@/lib/types/game";

export interface MajorFactionDefinition {
  /** Stable string key — used by world-gen, never user-facing. */
  key: string;
  name: string;
  description: string;
  governmentType: GovernmentType;
  doctrine: Doctrine;
  /** Hex color string (with leading #) for territory rendering. */
  color: string;
}

/**
 * 8 majors — one per government — seeded from faction-system.md §6.
 * Doctrine + government pairings deliberately mix to produce emergent rivalries
 * (see faction-system.md §6 "Emergent Rivalries"). Read at world-gen time;
 * the runtime faction model lives in the Faction table.
 */
export const FACTION_ROSTER: readonly MajorFactionDefinition[] = [
  {
    key: "terran_sovereignty",
    name: "Terran Sovereignty",
    description:
      "Democratic superpower. Stable and prosperous, with an overwhelming defensive response when challenged. The galactic status quo — everyone else defines themselves relative to the Terrans.",
    governmentType: "federation",
    doctrine: "protectionist",
    color: "#3a82c8",
  },
  {
    key: "meridian_compact",
    name: "Meridian Compact",
    description:
      "Trade confederation driven by profit above ideology. Richest faction. Fights with embargoes and proxy wars before committing their own fleets.",
    governmentType: "corporate",
    doctrine: "mercantile",
    color: "#d4a534",
  },
  {
    key: "kessari_dominion",
    name: "Kessari Dominion",
    description:
      "Centralized military empire. State-controlled economy funnels everything toward expansion. Aggressive and disciplined but chronically overextended.",
    governmentType: "authoritarian",
    doctrine: "expansionist",
    color: "#c83a3a",
  },
  {
    key: "free_reaches",
    name: "Free Reaches",
    description:
      "Loose alliance of lawless fringe systems held together by mutual distrust of centralized power. Strikes when neighbors are distracted, vanishes when confronted.",
    governmentType: "frontier",
    doctrine: "opportunistic",
    color: "#e07a2c",
  },
  {
    key: "arvani_communion",
    name: "Arvani Communion",
    description:
      "Insular faith-state built around ancient stellar prophecies. Peaceful and self-sufficient until sacred systems are threatened — then relentless. Heavy trade restrictions on immoral goods.",
    governmentType: "theocratic",
    doctrine: "protectionist",
    color: "#8a5cb8",
  },
  {
    key: "helix_ascendancy",
    name: "Helix Ascendancy",
    description:
      "Research-state that views technological superiority as a mandate to lead. Pressures weaker neighbors into client-state arrangements, sharing tech in exchange for resources and compliance.",
    governmentType: "technocratic",
    doctrine: "hegemonic",
    color: "#3acdc8",
  },
  {
    key: "solari_collective",
    name: "Solari Collective",
    description:
      "Worker-owned commune that believes all systems deserve liberation from exploitation. Genuinely idealistic, genuinely aggressive. Good intentions, uncomfortable methods.",
    governmentType: "cooperative",
    doctrine: "expansionist",
    color: "#5cb85c",
  },
  {
    key: "ironveil_pact",
    name: "Ironveil Pact",
    description:
      "Permanent war economy where every citizen serves. Not expansionist by ideology — they simply watch for weakened neighbors and strike when the cost is low. Respected and feared in equal measure.",
    governmentType: "militarist",
    doctrine: "opportunistic",
    color: "#7a8590",
  },
] as const;

// ── Minor faction procedural naming ──────────────────────────────

/**
 * Word pool for procedural minor faction naming. Combined as "Adjective Noun"
 * by world-gen, with rejection on duplicates. Pool size (30×20 = 600) is far
 * larger than `MINOR_FACTION_COUNT` so collisions are rare.
 */
export const MINOR_ADJECTIVES: readonly string[] = [
  "Onyx", "Coral", "Veiled", "Iron", "Drift", "Tidal", "Ember", "Hollow",
  "Glass", "Auric", "Vermilion", "Sable", "Argent", "Crimson", "Cobalt",
  "Brass", "Ashen", "Spire", "Cinder", "Quartz", "Obsidian", "Vermeil",
  "Lattice", "Solstice", "Equinox", "Nightward", "Sunward", "Hollowmoon",
  "Pale", "Stormwarden",
] as const;

export const MINOR_NOUNS: readonly string[] = [
  "Concord", "Reach", "Syndicate", "Vanguard", "Order", "Conclave", "Pact",
  "Choir", "Council", "League", "Brotherhood", "Watch", "Accord", "Circle",
  "Cartel", "Echelon", "Compact", "Junta", "Bloc", "Covenant",
] as const;

// ── Emergent-civ homeworld placement ─────────────────────────────
/**
 * Homeworlds are the only seeded ownership under emergent world-gen: one decent,
 * well-spaced home per faction, chosen from raw substrate. Weights + spacing are a
 * coarse first-cut (simulator-validated for coherence, not tuned — SP3 moves the
 * calibration target). Score terms are normalized to [0,1] across the candidate
 * pool so the weights are directly comparable.
 */
export const HOMEWORLD_PLACEMENT = {
  /** Aspirational minimum spacing between homeworlds, as a fraction of mapSize. */
  MIN_DISTANCE_FRACTION: 0.18,
  /** Threshold multiplier applied each time the full set can't be placed at the current spacing. */
  RELAX_RATE: 0.85,
  /** Relaxation steps before falling back to pure quality order (spacing ignored). */
  MAX_RELAX_STEPS: 12,
  /** Seed-bias weights over the four normalized substrate terms. */
  SCORE_WEIGHTS: { habitable: 1.0, diversity: 0.8, trait: 0.5, danger: 0.7 },
} as const;
