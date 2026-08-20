"use client";

import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import { useCommandMutation, type CommandMutation } from "@/lib/hooks/use-command-mutation";
import type { Speed } from "@/lib/world/tick-loop";
import type { SaveGameResult } from "@/lib/services/game";

type SaveGameData = Extract<SaveGameResult, { ok: true }>["data"];

/** Save the current world under a player-chosen name (`saveGame` command). */
export function useSaveGameMutation(): CommandMutation<string, SaveGameData> {
  return useCommandMutation((name: string) => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "saveGame", payload: { name } }).then((message) =>
      narrowCommandResult<SaveGameData>(message.result),
    );
  });
}

/**
 * Set the tick-loop speed (`setSpeed` command). No local echo needed — the worker's own pacing
 * frame (fed by `TickLoop.emit`, unconditionally on a speed change) carries the new speed back to
 * every `useTick`/`useTickContext` consumer the moment it's applied, whether or not this hook's own
 * caller is still mounted.
 */
export function useSpeedMutation(): CommandMutation<Speed, { speed: Speed }> {
  return useCommandMutation((speed: Speed) => {
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "setSpeed", payload: { speed } }).then((message) =>
      narrowCommandResult<{ speed: Speed }>(message.result),
    );
  });
}
