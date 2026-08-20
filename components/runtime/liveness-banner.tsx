"use client";

import { Button } from "@/components/ui/button";
import { useGameSlice } from "@/lib/store/use-game-store";

/**
 * The one genuinely new component this task adds (build plan Task 11, owner-approved
 * "Net-new UI"): a persistent bar surfacing the three failure states the store's `liveness` and
 * `autosaveFailure` fields carry (client-runtime spec §4, §5) — dead worker, a hard tick-pause, and
 * a failed autosave. Mounted once inside `GameShell` (`components/game-shell.tsx`), so it appears
 * on every in-game route and renders nothing on `"live"` with no standing autosave failure.
 *
 * Styled off the alert bar's InlineAlert convention (`docs/active/design-system/theme.md`:
 * `bg-status-{color}/10 border-status-{color}/20 text-status-{color}-light`) rather than a new
 * pattern — square corners, no new shape language.
 *
 * **What "Reload App" actually does, post-Task-12**: the web save backend is now IndexedDB
 * (`client/save-indexeddb.ts`), and autosave persists there for real — a page reload boots a fresh
 * worker, lands world-less on the start screen, and the player's own Continue/Load picks the
 * autosave back up (`lib/services/game.ts`'s `listGameSaves`/`loadGame`, now IndexedDB-backed).
 * "Reload App" genuinely recovers the last autosave for the dead-worker and paused-by-failure
 * states below; it does not (and could not) auto-load it itself — the start screen owns that choice,
 * same as any other session start. The autosave-failure state below has no reload path to offer
 * (the write itself is what failed) — it points at the start screen's Export control
 * (`components/start/start-screen.tsx`) instead, so a player can get bytes off the machine before
 * closing the tab.
 */
export function LivenessBanner() {
  const liveness = useGameSlice((state) => state.liveness);
  const failureCause = useGameSlice((state) => state.failureCause);
  const autosaveFailure = useGameSlice((state) => state.autosaveFailure);

  function reload(): void {
    window.location.reload();
  }

  if (liveness === "dead") {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 border-b border-status-red/20 bg-status-red/10 px-4 py-2 text-sm text-status-red-light"
      >
        <span>
          Connection to the game was lost. Reload to recover from the autosave.
        </span>
        <Button variant="outline" size="sm" onClick={reload}>
          Reload App
        </Button>
      </div>
    );
  }

  if (liveness === "paused" && failureCause !== null) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 border-b border-status-amber/20 bg-status-amber/10 px-4 py-2 text-sm text-status-amber-light"
      >
        <span>
          Game paused — {failureCause}. Reload to recover from the autosave.
        </span>
        <Button variant="outline" size="sm" onClick={reload}>
          Reload App
        </Button>
      </div>
    );
  }

  if (autosaveFailure !== null) {
    return (
      <div
        role="status"
        className="flex items-center justify-between gap-3 border-b border-status-amber/20 bg-status-amber/10 px-4 py-2 text-sm text-status-amber-light"
      >
        <span>
          Autosave failed — {autosaveFailure}. Export your save from the start screen before
          closing this tab.
        </span>
      </div>
    );
  }

  return null;
}
