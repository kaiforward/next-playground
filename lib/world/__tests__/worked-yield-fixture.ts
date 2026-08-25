/**
 * Shared two-body worked-yield fixture: a rich body (extractionModifier 1.0) whose single ore
 * slot beats a poor body's (extractionModifier 0.6) nine, so ground values sit far apart and a
 * worked count of one crosses a body boundary — the fold reads a value no pooled mean over both
 * bodies could produce, and a count change of one moves both columns by an amount no rounding
 * could.
 */
import { countColumns, makeResourceVector, qualColumns } from "@/lib/engine/resources";
import { toSlottedBody, type SlottedBody } from "@/lib/engine/worked-deposits";
import type { WorldBody } from "../types";

/** extractionModifier 1.0 — the rich body's class. */
export const RICH_TYPE = "temperate_world";
/** extractionModifier 0.6 — the poor body's class. */
export const POOR_TYPE = "frozen_world";

export function craftedBodies(systemId: string): WorldBody[] {
  return [
    {
      id: `${systemId}-rich`, systemId, bodyType: RICH_TYPE, size: 1, peopleLand: 5_000,
      ...countColumns(makeResourceVector({ ore: 1 })),
      ...qualColumns(makeResourceVector({ ore: 2 })),
    },
    {
      id: `${systemId}-poor`, systemId, bodyType: POOR_TYPE, size: 1, peopleLand: 0,
      ...countColumns(makeResourceVector({ ore: 9 })),
      ...qualColumns(makeResourceVector({ ore: 0.5 })),
    },
  ];
}

export function craftedSlots(systemId: string): SlottedBody[] {
  return craftedBodies(systemId).map(toSlottedBody);
}
