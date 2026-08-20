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
 * **Honest about what pre-Task-12 can actually do**: the web save backend (IndexedDB) doesn't exist
 * yet — the worker's save/load commands still dynamic-import the Node file backend, which fails at
 * runtime in a browser (a known, by-design Gate B finding). So neither state below offers a button
 * that claims to restore an autosave; "Reload App" does exactly what it says (a fresh page load,
 * fresh worker, world-less) and no more. Task 12 is what makes a real restore possible, at which
 * point this component's buttons are the seam that gets a real handler.
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
          Connection to the game was lost. Browser autosave restore isn&apos;t available in this
          build yet — reloading starts a new session.
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
          Game paused — {failureCause}. Browser autosave restore isn&apos;t available in this build
          yet — reloading starts a new session.
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
          Autosave failed — {autosaveFailure}. Manual export isn&apos;t available in this build yet
          — avoid closing this tab until you&apos;ve saved manually.
        </span>
      </div>
    );
  }

  return null;
}
