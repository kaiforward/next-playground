"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormError } from "@/components/form/form-error";
import { apiFetch, apiMutate } from "@/lib/query/fetcher";
import { AUTOSAVE_NAME } from "@/lib/world/save";
import type { SaveInfo } from "@/lib/world/save-files";
import type { WorldMeta } from "@/lib/world/types";

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function StartScreen() {
  const router = useRouter();
  const [saves, setSaves] = useState<SaveInfo[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Name of the save currently being loaded — doubles as the "busy" flag so
  // only one load can be in flight and its button shows the pending label.
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<SaveInfo[]>("/api/game/saves")
      .then((data) => {
        if (!cancelled) setSaves(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setListError(error instanceof Error ? error.message : "Failed to list saves");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLoad(name: string) {
    setLoadingName(name);
    setLoadError(null);
    try {
      await apiMutate<WorldMeta>("/api/game/load", { name });
      // Hard navigation on purpose: a fresh document gets a fresh TanStack
      // cache, so every staleTime-Infinity query re-fetches against the
      // newly loaded world.
      window.location.href = "/";
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
                Autosave — tick{" "}
                <span className="font-mono text-text-secondary">{autosave.tick}</span>,{" "}
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
        <Button fullWidth onClick={() => router.push("/start/new")}>
          New Game
        </Button>
      </Card>

      <Card>
        <CardHeader title="Load Game" />
        {listError ? (
          <FormError message={listError} />
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
                    Tick <span className="font-mono">{save.tick}</span> ·{" "}
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
        {loadError && <FormError message={loadError} />}
      </Card>
    </div>
  );
}
