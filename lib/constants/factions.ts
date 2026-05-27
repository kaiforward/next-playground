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
 * (see faction-system.md §6 "Emergent Rivalries"). Foundation reads this at
 * world-gen time; the runtime faction model lives in the Faction table.
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

// ── Minor faction archetypes ─────────────────────────────────────

export type MinorFactionArchetype = "buffer" | "frontier" | "enclave" | "cluster";

/**
 * Proportional split for procedural minor placement, per faction-system.md §7.1
 * and layer-2-faction-foundation.md Phase 2. World-gen assigns ceil(N × proportion)
 * to each archetype in declaration order; "cluster" absorbs the remainder so the
 * totals match the configured `MINOR_FACTION_COUNT` exactly.
 */
export const MINOR_ARCHETYPE_DISTRIBUTION: readonly {
  archetype: MinorFactionArchetype;
  proportion: number;
}[] = [
  { archetype: "buffer", proportion: 0.33 },
  { archetype: "frontier", proportion: 0.33 },
  { archetype: "enclave", proportion: 0.2 },
  { archetype: "cluster", proportion: 0 },
] as const;

/**
 * Per faction-system.md §7.1: minors start at 5–30 systems each. World-gen
 * post-processes flood-fill ownership to bring any minor below this floor up
 * to it by flipping its closest systems away from neighboring majors.
 */
export const MIN_MINOR_TERRITORY = 5;
