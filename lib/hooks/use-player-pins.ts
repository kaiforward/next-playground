"use client";

import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import { useCommandMutation, type CommandMutation } from "@/lib/hooks/use-command-mutation";
import { clearOnNextFrame } from "@/lib/store/command-overlay";
import { pinnedSystemIdsOverlay, GLOBAL_TRACKER_KEY } from "./use-tracker";
import type { PinInput } from "@/lib/schemas/player-pins";
import type { CommandResult } from "@/lib/runtime/channel";
import type { SetSystemPinResult } from "@/lib/services/player-pins";

type SetSystemPinData = Extract<SetSystemPinResult, { ok: true }>["data"];

function sendSetSystemPin(input: PinInput): Promise<CommandResult<SetSystemPinData>> {
  const id = crypto.randomUUID();
  return sendCommand({ id, type: "setSystemPin", payload: input }).then((message) =>
    narrowCommandResult<SetSystemPinData>(message.result),
  );
}

/**
 * Pin or unpin a system on the player's Tracker list (`setSystemPin` command).
 *
 * The command's result already carries the whole post-write id list (`SetSystemPinData`), so on a
 * successful commit this writes it straight into `useTracker`'s pin overlay — the client-runtime
 * in-flight rule (spec §2, `lib/store/command-overlay.ts`): a star toggle's pressed state flips on
 * this response, not on the next state frame, and a rapid second pin/unpin reads the first's
 * committed id list rather than a stale one (`use-tracker.ts`'s `useTracker` is the merge point).
 */
export function useSetSystemPin(): CommandMutation<PinInput, SetSystemPinData> {
  return useCommandMutation(async (input) => {
    const result = await sendSetSystemPin(input);
    if (result.ok) {
      pinnedSystemIdsOverlay.set(GLOBAL_TRACKER_KEY, result.data);
      clearOnNextFrame(pinnedSystemIdsOverlay, GLOBAL_TRACKER_KEY);
    }
    return result;
  });
}
