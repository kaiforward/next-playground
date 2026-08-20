"use client";

import { useCallback, useEffect, useState } from "react";
import { sendCommand } from "@/lib/runtime/command-client";
import { narrowCommandResult } from "@/lib/types/guards";
import { useCommandMutation, type CommandMutation } from "@/lib/hooks/use-command-mutation";
import { gameStore } from "@/lib/store/use-game-store";
import type { Speed } from "@/lib/world/tick-loop";
import type { SaveGameResult } from "@/lib/services/game";
import type { SaveInfo } from "@/lib/world/save-files";
import type { WorldMeta } from "@/lib/world/types";
import type { NewGameInput, LoadGameInput } from "@/lib/schemas/game-setup";

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

/**
 * Generate a fresh galaxy (`newGame` command) — world-less-valid (client-runtime spec §9). Calls
 * `gameStore.beginWorldReplacement()` synchronously before the command is even posted (spec §8's
 * swap-window contract, Proves 4): a read of any store slice between this call and the new world's
 * own full frame landing gets the defined no-world default, never the outgoing world's stale data.
 * Correct whether or not a world existed beforehand — resetting an already-empty store is a no-op.
 */
export function useNewGameMutation(): CommandMutation<NewGameInput, WorldMeta> {
  return useCommandMutation((input: NewGameInput) => {
    gameStore.beginWorldReplacement();
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "newGame", payload: input }).then((message) =>
      narrowCommandResult<WorldMeta>(message.result),
    );
  });
}

/** Load a save into the store (`loadGame` command) — same swap-window reset as `useNewGameMutation`
 *  and for the same reason: a load can replace a LIVE game, not only a world-less one. */
export function useLoadGameMutation(): CommandMutation<LoadGameInput, WorldMeta> {
  return useCommandMutation((input: LoadGameInput) => {
    gameStore.beginWorldReplacement();
    const id = crypto.randomUUID();
    return sendCommand({ id, type: "loadGame", payload: input }).then((message) =>
      narrowCommandResult<WorldMeta>(message.result),
    );
  });
}

export interface SavesListState {
  saves: SaveInfo[] | null;
  error: string | null;
  refresh: () => void;
}

/**
 * Lists saves via the `listSaves` command — world-less-valid (spec §9), so the start screen can
 * populate its Continue/Load cards before any world exists. A round trip through the worker rather
 * than a synchronous store read: unlike every other read hook, "which saves exist on disk" is not
 * part of any `StateFrame` slice — it lives in the save backend, not the world.
 */
export function useSavesList(): SavesListState {
  const [saves, setSaves] = useState<SaveInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    const id = crypto.randomUUID();
    sendCommand({ id, type: "listSaves", payload: null }).then((message) => {
      const result = narrowCommandResult<SaveInfo[]>(message.result);
      if (result.ok) {
        setSaves(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { saves, error, refresh };
}
