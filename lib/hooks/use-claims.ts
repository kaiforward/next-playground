"use client";

import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import { useCommandMutation, type CommandMutation } from "@/lib/hooks/use-command-mutation";
import type { ClaimSystemResult } from "@/lib/services/claims";

type ClaimSystemData = Extract<ClaimSystemResult, { ok: true }>["data"];

/** Claim an unclaimed, adjacent system for the player's faction (`claimSystem` command). */
export function useClaimSystem(systemId: string): CommandMutation<void, ClaimSystemData> {
  return useCommandMutation(() => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "claimSystem", payload: { systemId } }).then((message) =>
      narrowCommandResult<ClaimSystemData>(message.result),
    );
  });
}
