"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateFactionForm } from "@/components/start/create-faction-form";
import { useSavesList, useLoadGameMutation } from "@/lib/hooks/use-game-lifecycle";
import { useNavigate } from "@/components/ui/link-provider";
import { mapHref } from "@/lib/utils/route-hrefs";
import { AUTOSAVE_NAME } from "@/lib/world/save";
import { formatDate } from "@/lib/utils/calendar";

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * The Task-12 seam (Gate C smoke finding B): `listSaves`/`loadGame`/`saveGame` all dynamic-import
 * the Node file backend (`lib/services/game.ts`), which cannot load in a browser — every save
 * operation fails identically until Task 12 ships the IndexedDB backend. Rather than surface that
 * raw failure ("Failed to fetch dynamically imported module …/lib/world/save-files.ts") to the
 * player, both the saves-list read and a load attempt render this one honest, quiet message — New
 * Game (`newGame`, which never touches the save backend) stays fully functional regardless.
 */
const SAVES_UNAVAILABLE_MESSAGE = "Saves aren't available in the browser yet.";

/**
 * The entry screen (client-runtime spec §9, build plan Task 11) — listing saves, loading and
 * starting a new game are all worker commands valid before a world exists
 * (`lib/hooks/use-game-lifecycle.ts`'s `useSavesList`/`useLoadGameMutation`/`useNewGameMutation`,
 * the last reached through `CreateFactionForm` inside the dialog below). On success each navigates
 * to the map root itself (`mapHref()`) — never a hard `window.location.href` reload: the worker
 * already replaced the world in one store commit (`GameStore.beginWorldReplacement` +
 * `applyStateFrame`, spec §8), so there is nothing a fresh document would buy here that a client
 * route change doesn't already give for free.
 *
 * New Game moves into a `Dialog` rather than its own route: the route table
 * (`client/routes.ts`) has no `/start/new` entry, and reusing `Dialog`/`useDialog` here is this
 * task's named reuse target rather than growing the route table for one form.
 */
export function StartScreen() {
  const navigate = useNavigate();
  const { saves, error: listError } = useSavesList();
  const loadGame = useLoadGameMutation();
  const newGameDialog = useDialog();
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function handleLoad(name: string) {
    setLoadingName(name);
    setLoadError(null);
    try {
      await loadGame.mutateAsync({ name });
      navigate(mapHref());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load save");
      setLoadingName(null);
    }
  }

  const autosave = saves?.find((s) => s.name === AUTOSAVE_NAME);
  const manualSaves = saves?.filter((s) => s.name !== AUTOSAVE_NAME) ?? [];

  return (
    <div className="w-full max-w-md flex flex-col gap-4">
      {autosave && (
        <Card>
          <CardHeader
            title="Continue"
            subtitle={
              <>
                Autosave —{" "}
                <span className="font-mono text-text-secondary">{formatDate(autosave.tick)}</span>,{" "}
                {formatSavedAt(autosave.savedAt)}
              </>
            }
          />
          <Button
            fullWidth
            onClick={() => handleLoad(AUTOSAVE_NAME)}
            disabled={loadingName !== null}
          >
            {loadingName === AUTOSAVE_NAME ? "Loading…" : "Continue"}
          </Button>
        </Card>
      )}

      <Card>
        <CardHeader title="New Game" subtitle="Author a faction and drop into a fresh galaxy." />
        <Button fullWidth onClick={newGameDialog.onOpen}>
          New Game
        </Button>
      </Card>

      <Card>
        <CardHeader title="Load Game" />
        {listError ? (
          <EmptyState message={SAVES_UNAVAILABLE_MESSAGE} />
        ) : saves === null ? (
          <EmptyState message="Loading saves…" />
        ) : manualSaves.length === 0 ? (
          <EmptyState message="No saved games yet." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {manualSaves.map((save) => (
              <li key={save.name} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-sm text-text-primary truncate">{save.name}</p>
                  <p className="text-xs text-text-tertiary">
                    <span className="font-mono">{formatDate(save.tick)}</span> ·{" "}
                    {formatSavedAt(save.savedAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleLoad(save.name)}
                  disabled={loadingName !== null}
                >
                  {loadingName === save.name ? "Loading…" : "Load"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {/* Same Task-12 seam as `listError` above — `loadGame` dynamic-imports the same Node
            backend, so it fails identically until Task 12; the raw message is never shown. */}
        {loadError && <EmptyState message={SAVES_UNAVAILABLE_MESSAGE} className="mt-2" />}
      </Card>

      <Dialog open={newGameDialog.open} onClose={newGameDialog.onClose} modal size="sm">
        <CardHeader title="New Game" subtitle="Author the faction you'll rule." />
        <CreateFactionForm onSuccess={newGameDialog.onClose} />
      </Dialog>
    </div>
  );
}
