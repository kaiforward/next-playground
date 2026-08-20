"use client";

import { useGameSlice } from "@/lib/store/use-game-store";
import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import { useCommandMutation, type CommandMutation } from "@/lib/hooks/use-command-mutation";
import { createOverlayStore, useOverlay, clearOnNextFrame } from "@/lib/store/command-overlay";
import { TREASURY } from "@/lib/constants/treasury";
import type { FactionTreasuryData, TreasuryPolicyData } from "@/lib/types/api";
import type { TreasuryPolicyInput } from "@/lib/schemas/treasury";
import type { CommandResult } from "@/lib/runtime/channel";
import type { UpdateTreasuryPolicyResult } from "@/lib/services/treasury";

type UpdateTreasuryPolicyData = Extract<UpdateTreasuryPolicyResult, { ok: true }>["data"];

/**
 * `FactionTreasuryData` carries no discriminant to reuse and its only caller
 * (`components/factions/treasury-card.tsx`) reads its fields directly with no absence check — the
 * same Task 7 judgment call `useFactionVitals`/`useFactionConstruction` made (see those hooks'
 * docstrings): an absent factionId reads as a zero-valued treasury rather than a new union member
 * that caller would need to narrow.
 */
const NOT_FOUND: FactionTreasuryData = {
  factionId: "",
  balance: 0,
  taxLevel: "normal",
  bands: { maintenance: TREASURY.MAINTENANCE_SLIDER_FLOOR, logistics: 0, construction: 0 },
  funded: { maintenance: 0, logistics: 0, construction: 0 },
  net: 0,
  foundingCommitted: 0,
  lastSettlement: null,
};

/** One overlay per faction id — treasury policy is the only per-id (not single-player-global)
 *  in-flight overlay this task needs, since a game can have multiple factions' cards open (the
 *  faction screen is a god-view) even though only the player's own is interactive. */
const treasuryPolicyOverlay = createOverlayStore<TreasuryPolicyData>();

/**
 * One faction's treasury surface, read from the store's `factionTreasury` slice.
 *
 * Overlaid with any in-flight policy write's committed `{taxLevel, bands}` (`useUpdateTreasuryPolicy`
 * below) — the client-runtime in-flight rule (spec §2) that replaces the read-modify-write hazard
 * the query-layer census found (C4): `TreasuryCard`'s `commitBand` spreads `data.bands` to build its
 * NEXT commit's payload, so a stale (pre-commit) `data.bands` here would let a quick second slider
 * release silently revert the first change. The overlay is what keeps `data.bands` current the
 * instant a commit resolves, rather than waiting for the next state frame.
 */
export function useFactionTreasury(factionId: string): FactionTreasuryData {
  const slice = useGameSlice((state) => state.slices.factionTreasury?.[factionId]);
  const overlay = useOverlay(treasuryPolicyOverlay, factionId);
  const base = slice ?? NOT_FOUND;
  return overlay ? { ...base, taxLevel: overlay.taxLevel, bands: overlay.bands } : base;
}

function sendUpdateTreasuryPolicy(
  factionId: string,
  input: TreasuryPolicyInput,
): Promise<CommandResult<TreasuryPolicyData>> {
  const id = crypto.randomUUID();
  return sendCommand({ id, type: "updateTreasuryPolicy", payload: { factionId, ...input } }).then(
    (message) => narrowCommandResult<UpdateTreasuryPolicyData>(message.result),
  );
}

/** Set the player faction's tax level and/or band sliders (`updateTreasuryPolicy` command). */
export function useUpdateTreasuryPolicy(factionId: string): CommandMutation<TreasuryPolicyInput, TreasuryPolicyData> {
  return useCommandMutation(async (input) => {
    const result = await sendUpdateTreasuryPolicy(factionId, input);
    if (result.ok) {
      treasuryPolicyOverlay.set(factionId, result.data);
      clearOnNextFrame(treasuryPolicyOverlay, factionId);
    }
    return result;
  });
}
