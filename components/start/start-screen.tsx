"use client";

import { useRef, useState } from "react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, useDialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { CreateFactionForm } from "@/components/start/create-faction-form";
import {
  useSavesList,
  useLoadGameMutation,
  useExportSaveMutation,
  useImportSaveMutation,
} from "@/lib/hooks/use-game-lifecycle";
import { useNavigate } from "@/components/ui/link-provider";
import { mapHref } from "@/lib/utils/route-hrefs";
import { AUTOSAVE_NAME, sanitiseSaveName } from "@/lib/world/save";
import { formatDate } from "@/lib/utils/calendar";
import { downloadTextFile } from "@/lib/utils/download-file";

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString();
}

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
  const { saves, error: listError, refresh } = useSavesList();
  const loadGame = useLoadGameMutation();
  const exportSave = useExportSaveMutation();
  const importSave = useImportSaveMutation();
  const newGameDialog = useDialog();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exportingName, setExportingName] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

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

  async function handleExport(name: string) {
    setExportingName(name);
    setExportError(null);
    try {
      const { name: sanitisedName, json } = await exportSave.mutateAsync(name);
      downloadTextFile(`${sanitisedName}.json`, json);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Failed to export save");
    } finally {
      setExportingName(null);
    }
  }

  async function handleImportFile(file: File) {
    setImportError(null);
    const json = await file.text();
    const name = sanitiseSaveName(file.name.replace(/\.json$/i, "")) || "imported";
    try {
      await importSave.mutateAsync({ name, json });
      refresh();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import save");
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
          <div className="flex gap-2">
            <Button
              fullWidth
              onClick={() => handleLoad(AUTOSAVE_NAME)}
              disabled={loadingName !== null}
            >
              {loadingName === AUTOSAVE_NAME ? "Loading…" : "Continue"}
            </Button>
            <Button
              variant="outline"
              onClick={() => handleExport(AUTOSAVE_NAME)}
              disabled={exportingName !== null}
            >
              {exportingName === AUTOSAVE_NAME ? "Exporting…" : "Export"}
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="New Game" subtitle="Author a faction and drop into a fresh galaxy." />
        <Button fullWidth onClick={newGameDialog.onOpen}>
          New Game
        </Button>
      </Card>

      <Card>
        <CardHeader
          title="Load Game"
          action={
            <Button variant="outline" size="sm" onClick={() => importInputRef.current?.click()}>
              Import
            </Button>
          }
        />
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label="Import save file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleImportFile(file);
          }}
        />
        {listError ? (
          <EmptyState message={listError} />
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
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleExport(save.name)}
                    disabled={exportingName !== null}
                  >
                    {exportingName === save.name ? "Exporting…" : "Export"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleLoad(save.name)}
                    disabled={loadingName !== null}
                  >
                    {loadingName === save.name ? "Loading…" : "Load"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {loadError && <EmptyState message={loadError} className="mt-2" />}
        {exportError && <EmptyState message={exportError} className="mt-2" />}
        {importError && <EmptyState message={importError} className="mt-2" />}
      </Card>

      <Dialog open={newGameDialog.open} onClose={newGameDialog.onClose} modal size="sm">
        <CardHeader title="New Game" subtitle="Author the faction you'll rule." />
        <CreateFactionForm onSuccess={newGameDialog.onClose} />
      </Dialog>
    </div>
  );
}
