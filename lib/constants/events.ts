import { summarisePhaseEffects } from "@/lib/utils/event-effects";

// ── Event type union ────────────────────────────────────────────

// All three types are relations-spawned. Only the relations processor creates
// them, tagging the participant pair via GameEvent.metadata; the events
// processor never rolls dice to spawn one.
export type EventTypeId =
  | "border_conflict"
  | "pact_under_negotiation"
  | "alliance_dissolved";

// ── Type interfaces ─────────────────────────────────────────────

export interface ModifierTemplate {
  domain: "economy";
  type: "anchor_shift" | "rate_multiplier";
  target: "system" | "region";
  goodId?: string | null;
  parameter: string; // "target_stock" (anchor_shift), "production_rate"/"consumption_rate" (rate_multiplier)
  value: number;     // Multiplier on the modified parameter
}

export interface EventPhaseDefinition {
  name: string;
  displayName: string;
  durationRange: [number, number];
  modifiers: ModifierTemplate[];
  /** Authored player-facing effects line for a phase whose modifiers derive nothing —
   *  `summarisePhaseEffects` falls back to this instead of its generic "Minor market
   *  effects" text when present. A phase that does derive modifier parts always shows
   *  those instead; this can never shadow a real effect. */
  effectSummary?: string;
}

export interface EventDefinition {
  type: EventTypeId;
  name: string;
  description: string;
  phases: EventPhaseDefinition[];
}

/** Safety caps for aggregated modifier values. */
export const MODIFIER_CAPS = {
  /** Minimum anchor multiplier (never fully zero out the anchor). */
  minAnchorMult: 0.1,
  /** Maximum anchor multiplier. */
  maxAnchorMult: 4.0,
  /** Minimum rate multiplier (never fully zero out production). */
  minMultiplier: 0.1,
  /** Maximum rate multiplier. */
  maxMultiplier: 3.0,
} as const;

// ── Event definitions ───────────────────────────────────────────
// NOTE: anchor_shift values are MULTIPLIERS on a good's pricing anchor (1.0 = no change, 2.0 = double = pricier, 0.5 = half = cheaper).

/**
 * Border conflict: spawned by the relations processor when a faction pair
 * crosses into the unfriendly band (-74 to -25). Targets a representative
 * border system; carries `{ factionAId, factionBId }` in GameEvent.metadata.
 * No notifications — these surface on the political map, not in player feeds.
 */
const borderConflict: EventDefinition = {
  type: "border_conflict",
  name: "Border Conflict",
  description: "Skirmishes erupt along a contested faction border, disrupting production.",
  phases: [
    {
      name: "tension",
      displayName: "Border Tension",
      durationRange: [15, 25],
      modifiers: [],
      effectSummary: "Forces massing at the border",
    },
    {
      name: "skirmish",
      displayName: "Skirmish",
      durationRange: [25, 35],
      modifiers: [
        { domain: "economy", type: "rate_multiplier", target: "system", goodId: null, parameter: "production_rate", value: 0.9 },
      ],
    },
    {
      name: "de_escalation",
      displayName: "De-escalation",
      durationRange: [10, 20],
      modifiers: [],
      effectSummary: "Forces standing down",
    },
  ],
};

/**
 * Pact under negotiation: created when a faction pair's relations cross +75.
 * Holds for ALLIANCE.negotiationWindow ticks; if the score stays at or above
 * ALLIANCE.holdThreshold through that window, the AlliancePact is formed.
 * No system/region target — purely a political-map signal.
 */
const pactUnderNegotiation: EventDefinition = {
  type: "pact_under_negotiation",
  name: "Pact Under Negotiation",
  description: "Two factions are negotiating a formal alliance — outcome decided when the window closes.",
  phases: [
    {
      name: "negotiation",
      displayName: "Negotiation",
      durationRange: [5, 10],
      modifiers: [],
      effectSummary: "Envoys shuttling between capitals",
    },
  ],
};

/**
 * Alliance dissolution: warning event spawned when a pair drops below
 * ALLIANCE.dissolutionThreshold while a pact is active. After the window
 * the AlliancePact is removed.
 */
const allianceDissolved: EventDefinition = {
  type: "alliance_dissolved",
  name: "Alliance Dissolving",
  description: "Relations between two allied factions have soured; the pact is being dissolved.",
  phases: [
    {
      name: "dissolving",
      displayName: "Dissolving",
      durationRange: [5, 5],
      modifiers: [],
      effectSummary: "Ambassadors packing for home",
    },
  ],
};

/** All registered event definitions, keyed by type. */
const EVENT_DEFINITIONS_INTERNAL = {
  border_conflict: borderConflict,
  pact_under_negotiation: pactUnderNegotiation,
  alliance_dissolved: allianceDissolved,
} as const satisfies Record<EventTypeId, EventDefinition>;

export const EVENT_DEFINITIONS: Record<EventTypeId, EventDefinition> = EVENT_DEFINITIONS_INTERNAL;

/** Event types created by the relations processor — never randomly spawned.
 *  Today this is every event type; kept distinct from `EventTypeId` for the
 *  one reader (`lib/world/tick.ts`) that means "relations-owned", not "all". */
export const RELATIONS_EVENT_TYPES = [
  "border_conflict",
  "pact_under_negotiation",
  "alliance_dissolved",
] as const satisfies readonly EventTypeId[];

// ── Phase effect summaries ──────────────────────────────────────

/**
 * Pre-computed effect summaries for every (eventType, phaseName) pair.
 * Built once at module load — modifiers are constants so the output never changes.
 */
const PHASE_EFFECT_SUMMARIES: Record<string, string> = {};
for (const [type, def] of Object.entries(EVENT_DEFINITIONS)) {
  for (const phase of def.phases) {
    PHASE_EFFECT_SUMMARIES[`${type}:${phase.name}`] = summarisePhaseEffects(phase);
  }
}

/**
 * Get the effect summary for a specific event type and phase name.
 * Returns a short human-readable string describing the phase's impact.
 */
export function getPhaseEffectSummary(eventType: EventTypeId, phaseName: string): string {
  return PHASE_EFFECT_SUMMARIES[`${eventType}:${phaseName}`] ?? "";
}
