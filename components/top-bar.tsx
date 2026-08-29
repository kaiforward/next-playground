"use client";

import { ErrorBoundary } from "react-error-boundary";
import { Save, DoorOpen, Coins, Hexagon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLinkComponent } from "@/components/ui/link-provider";
import { useDialog } from "@/components/ui/dialog";
import { renderNothingFallback } from "@/components/ui/error-fallback";
import { SaveGameDialog } from "@/components/save-game-dialog";
import { SpeedControls } from "@/components/speed-controls";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { useFactionTreasury } from "@/lib/hooks/use-faction-treasury";
import { useFactionVitals } from "@/lib/hooks/use-faction-vitals";
import { foundingWorkingBalance } from "@/lib/engine/treasury";
import { formatMagnitude, formatSignedMagnitude } from "@/lib/utils/format";
import { formatDate, formatTimeOfDay } from "@/lib/utils/calendar";
import { TermLabel } from "@/components/ui/term-label";

/* ------------------------------------------------------------------ */
/*  Player faction flag + stats                                       */
/* ------------------------------------------------------------------ */

/**
 * The player faction's presence on the bar: a flag button (a solid colour
 * rectangle for now — no flag art exists yet) opening the faction panel, then
 * the headline stats beside it. The flag is full-bleed against the header's
 * top/left/bottom edges, which is why `TopBar` carries no left padding of its
 * own. Renders nothing when the world has no player seat.
 */
export function PlayerFactionSummary() {
  const LinkComponent = useLinkComponent();
  const { atlas } = useAtlas();
  const factionId = atlas.player?.controlledFactionId;
  const faction = atlas.factions.find((f) => f.id === factionId);
  if (!faction) return null;

  return (
    <>
      <LinkComponent
        href={`/factions/${faction.id}`}
        aria-label={`${faction.name} — open faction panel`}
        title={faction.name}
        className="h-full w-14 shrink-0 transition-[filter] hover:brightness-125"
        style={{ backgroundColor: faction.color }}
      />
      <PlayerFactionStats factionId={faction.id} />
    </>
  );
}

/**
 * The stat run — credits first: the AVAILABLE number (balance minus money
 * committed to founding, same figure every treasury surface quotes) with the
 * last settlement's net beside it, then owned-system count. Both reads are
 * tick-invalidated keys shared with the faction panel's own cards, so
 * co-rendering costs no extra fetch.
 */
function PlayerFactionStats({ factionId }: { factionId: string }) {
  const treasury = useFactionTreasury(factionId);
  const vitals = useFactionVitals(factionId);
  const available = foundingWorkingBalance(treasury.balance, treasury.foundingCommitted);

  return (
    <div className="flex items-center gap-4">
      <span
        className="flex items-center gap-1.5 whitespace-nowrap"
        title="Credits available · net per cycle"
      >
        <Coins aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <span className="sr-only">Credits available</span>
        <span className="font-mono text-sm text-text-primary">{formatMagnitude(available)}</span>
        <span
          className={`font-mono text-xs ${
            treasury.net < 0 ? "text-status-red-light" : "text-status-green-light"
          }`}
        >
          {formatSignedMagnitude(treasury.net)}/cyc
        </span>
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap" title="Systems owned">
        <Hexagon aria-hidden className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <span className="sr-only">Systems owned</span>
        <span className="font-mono text-sm text-text-primary">{vitals.territorySize}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tick / TPS readout                                                */
/* ------------------------------------------------------------------ */

export function TickReadout() {
  const { currentTick, achievedTps } = useTickContext();
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono text-text-secondary whitespace-nowrap">
      <span className="h-1.5 w-1.5 rounded-full bg-status-green animate-pulse shrink-0" />
      {/* The raw tick survives only in the title — the shipped UI reads the fictional calendar. */}
      <span title={`tick ${currentTick}`}>
        <span className="text-secondary">{formatDate(currentTick)}</span>{" "}
        <span className="text-text-primary">{formatTimeOfDay(currentTick)}</span>{" "}
        <TermLabel id="ust" />
      </span>
      <span className="text-text-tertiary">·</span>
      <span>
        <span className="text-text-primary">{achievedTps}</span> tps
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Top bar                                                           */
/* ------------------------------------------------------------------ */

export function TopBar() {
  const saveDialog = useDialog();

  return (
    // No left padding: the faction flag sits full-bleed against the header's edges.
    <header className="h-[var(--topbar-height)] flex items-center gap-5 pr-3.5 bg-background border-b border-border shrink-0">
      <h1 className="sr-only">Stellar Trader</h1>

      {/* Left: player faction flag + stats. The boundary degrades this cluster
          alone — a treasury fetch failure must not take the save/exit verbs with it. */}
      <ErrorBoundary fallbackRender={renderNothingFallback}>
        <PlayerFactionSummary />
      </ErrorBoundary>

      <div className="flex-1" />

      {/* Center: simulation speed + tick/tps */}
      <div className="flex items-center gap-4 shrink-0">
        <SpeedControls />
        <TickReadout />
      </div>

      {/* Right: save / exit */}
      <div className="flex items-center gap-1 shrink-0">
        <Button variant="ghost" size="sm" onClick={saveDialog.onOpen}>
          <Save className="w-4 h-4" />
          <span className="ml-1.5">Save</span>
        </Button>
        <Button variant="ghost" size="sm" href="/start">
          <DoorOpen className="w-4 h-4" />
          <span className="ml-1.5">Exit</span>
        </Button>
      </div>
      <SaveGameDialog open={saveDialog.open} onClose={saveDialog.onClose} />
    </header>
  );
}
