"use client";

import { useCallback, useState } from "react";
import type { CommandResult } from "@/lib/runtime/channel";

export interface CommandMutationOptions<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: string) => void;
}

export interface CommandMutation<TInput, TData> {
  mutate(input: TInput, options?: CommandMutationOptions<TData>): void;
  mutateAsync(input: TInput): Promise<TData>;
  isPending: boolean;
}

/**
 * Wraps one command-dispatching async function with the `mutate`/`mutateAsync`/`isPending` surface
 * every mutation hook's `components/` callers already expect — the TanStack `useMutation` shape
 * carried over verbatim, per this task's "mutation hooks keep signatures" interface line, so no
 * consumer changes.
 *
 * `run` is supplied fully concretely by each domain hook (e.g. `(input: PinInput) =>
 * sendSetSystemPin(input)`) — this wrapper is generic over `TInput`/`TData` only, never over which
 * worker command is dispatched, so it carries none of `lib/runtime/command-client.ts`'s
 * envelope-construction constraint.
 *
 * `mutateAsync` rejects with `new Error(result.error)` on a rejected command — never a silently
 * swallowed failure (Proves 4) — matching `useSaveGameMutation`'s only `mutateAsync` caller
 * (`components/save-game-dialog.tsx`), which awaits it in a try/catch. `mutate` never throws to its
 * caller: a rejection reaches `options.onError` if given, else `console.error` (mirrors
 * `client/main.tsx`'s own "never let a rejected command vanish" posture, Task 6).
 */
export function useCommandMutation<TInput, TData>(
  run: (input: TInput) => Promise<CommandResult<TData>>,
): CommandMutation<TInput, TData> {
  const [isPending, setIsPending] = useState(false);

  const mutateAsync = useCallback(
    async (input: TInput): Promise<TData> => {
      setIsPending(true);
      try {
        const result = await run(input);
        if (!result.ok) throw new Error(result.error);
        return result.data;
      } finally {
        setIsPending(false);
      }
    },
    [run],
  );

  const mutate = useCallback(
    (input: TInput, options?: CommandMutationOptions<TData>) => {
      void mutateAsync(input).then(
        (data) => options?.onSuccess?.(data),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (options?.onError) options.onError(message);
          else console.error("[useCommandMutation] command rejected:", message);
        },
      );
    },
    [mutateAsync],
  );

  return { mutate, mutateAsync, isPending };
}
