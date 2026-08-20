"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useTracker } from "@/lib/hooks/use-tracker";
import { useSystemFocus } from "@/lib/hooks/use-system-focus";
import { useSetSystemPin } from "@/lib/hooks/use-player-pins";
import { renderErrorFallback } from "@/components/ui/error-fallback";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { barWidthPct } from "@/lib/utils/math";
import { PersonIcon, SettingsIcon } from "@/components/ui/icons";
import { TrackerRow, type TrackerFigure } from "@/components/tracker/tracker-row";
import { stabilityRampColor } from "@/lib/utils/stability";
import { formatPeople } from "@/lib/utils/format";
import { formatEta } from "@/lib/utils/construction-format";
import type { TrackerPinnedRow, TrackerRowBase } from "@/lib/types/api";

/** Building-row display cap (docs/active/gameplay/tracker.md → "Rows and the card": a dozen rows are
 *  scannable, hundreds are not). The funded front can run to dozens of parallel projects in a real
 *  game; only the first `BUILDING_ROW_CAP` in queue order render, and the rest are named in the
 *  summary line rather than dropped silently. */
const BUILDING_ROW_CAP = 10;

export interface TrackerPanelProps {
  /** Pressed-state for the header's settings toggle — the settings panel itself is a sibling
   *  `MapRightRail` mounts conditionally, not something this component renders. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

/**
 * The Tracker panel (docs/active/gameplay/tracker.md) — pinned systems, the player faction's
 * funded construction front, and its forming colonies. Owns `useTracker()` inside an
 * `ErrorBoundary` so a read failure here degrades the panel, not the map behind it.
 *
 * The header — title plus the settings toggle button — renders OUTSIDE the `ErrorBoundary`, so it
 * stays reachable both with every section hidden and with the read itself failing: it is the only
 * way back into the settings panel.
 *
 * Mounted from `components/map/map-right-rail.tsx`, as the right-hand member of the horizontal
 * pair it shares with `TrackerSettings` (rendered as its sibling to the left, when open) inside
 * the right-edge column's upper region, above `MapControlsDock`. `h-full min-h-0` here is what
 * lets it stretch to fill whatever height the shared row is given and still shrink internally —
 * see the layout note on `MapRightRail` — with `TrackerPanelContent`'s own `overflow-y-auto`
 * taking over from that point, no measured/guessed max-height.
 */
export function TrackerPanel({ settingsOpen, onToggleSettings }: TrackerPanelProps) {
  // Where focus goes when unpinning empties the Pinned section — see `TrackerPanelContent`'s
  // unpin handling. The header is the one control that is always here whatever the sections do.
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="pointer-events-auto flex h-full min-h-0 w-72 shrink-0 flex-col border border-border bg-surface/95 shadow-lg backdrop-blur">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
          Tracker
        </h2>
        <Button
          ref={settingsButtonRef}
          variant="ghost"
          size="iconXs"
          aria-pressed={settingsOpen}
          aria-label="Tracker settings"
          onClick={onToggleSettings}
        >
          <SettingsIcon aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ErrorBoundary fallbackRender={renderErrorFallback}>
        <TrackerPanelContent fallbackFocusRef={settingsButtonRef} />
      </ErrorBoundary>
    </div>
  );
}

/** The row to put focus on once an unpinned row has gone, decided while the list still has it. */
interface PendingUnpinFocus {
  /** The row being unpinned — the handoff waits until this one has actually left the list. */
  removedId: string;
  /** The next pinned row, or the previous one when the unpinned row was last; null when it was
   *  the only one and the section is about to be empty. */
  nextId: string | null;
}

function TrackerPanelContent({
  fallbackFocusRef,
}: {
  fallbackFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  // `sections` rides the same payload as the rows it filters, so this component reads its own
  // visibility rather than taking it as a prop — and `TrackerSettings`, which is mounted as a
  // sibling one level up, reads the same cached query. The two cannot disagree: TanStack's cache is
  // the single instance the old shared-hook-instance rule was standing in for.
  const data = useTracker();
  const { sections } = data;
  const activate = useSystemFocus();
  const setPin = useSetSystemPin();
  // Scoped to the Pinned list on purpose: a system can appear in Pinned AND in Building at the
  // same time, and both rows carry the same `data-system-id`.
  const pinnedListRef = useRef<HTMLUListElement>(null);
  const pendingUnpinFocusRef = useRef<PendingUnpinFocus | null>(null);

  /**
   * Unpinning from a row's own card deletes the thing the user is standing on: the mutation
   * invalidates the tracker query, the row leaves `pinned`, and the `<li>`, its trigger and the
   * card the Unpin button lives in all unmount together. There is no trigger left for the card to
   * hand focus back to, so focus would fall to the document body and the next Tab would restart
   * from the top of the page.
   *
   * The neighbour is chosen HERE, while the list still contains the row — the card knows only its
   * own row — and the handoff itself waits for the row to actually go (see the effect below).
   */
  function unpin(systemId: string) {
    const index = data.pinned.findIndex((row) => row.systemId === systemId);
    const neighbour = data.pinned[index + 1] ?? data.pinned[index - 1] ?? null;
    pendingUnpinFocusRef.current = { removedId: systemId, nextId: neighbour?.systemId ?? null };
    setPin.mutate(
      { systemId, pinned: false },
      // A write that failed leaves the row where it is, and a handoff left pending would fire
      // later — on whatever eventually removes that row, from the system panel's star, with the
      // user's attention somewhere else entirely. Focus is only ever moved for a row this panel
      // actually saw leave.
      { onError: () => void (pendingUnpinFocusRef.current = null) },
    );
  }

  useEffect(() => {
    const pending = pendingUnpinFocusRef.current;
    if (!pending) return;
    // Not until the row is gone: the mutation is a round trip, and every render before the
    // invalidated query comes back still has the row, its card and the focus inside it.
    if (data.pinned.some((row) => row.systemId === pending.removedId)) return;
    pendingUnpinFocusRef.current = null;
    const nextRow = pending.nextId
      ? pinnedListRef.current?.querySelector<HTMLButtonElement>(
          `[data-system-id="${pending.nextId}"] button`,
        )
      : null;
    // The section can also have emptied, or been hidden by the settings panel between the click
    // and the response, in which case there is no row left to land on and the panel's own header
    // takes it — still inside the Tracker, and still ahead of every section in tab order.
    (nextRow ?? fallbackFocusRef.current)?.focus();
  }, [data.pinned, fallbackFocusRef]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Hiding a section (TrackerSettings) drops its heading along with its rows — it is not
          rendered at all rather than rendered empty, per docs/active/gameplay/tracker.md → "Settings". */}
      {sections.pinned && (
        <TrackerSection title="Pinned" count={data.pinned.length} emptyMessage="No pinned systems yet.">
          <ul ref={pinnedListRef}>
            {/* Keyed on systemId — safe here because pinnedSystemIds is deduped (a bookmark set, not a
                project list), unlike the Building list below. */}
            {data.pinned.map((row) => (
              <TrackerRow
                key={row.systemId}
                systemId={row.systemId}
                name={row.systemName}
                figures={pinnedFigures(row)}
                onActivate={() => activate(row.systemId, "")}
                cardLabel={`${row.systemName} vitals`}
                card={<PinnedCard row={row} onUnpin={() => unpin(row.systemId)} />}
              />
            ))}
          </ul>
        </TrackerSection>
      )}

      {sections.building && (
        <TrackerSection
          title="Building"
          count={data.building.length}
          emptyMessage="Nothing funded this cycle."
          /* Two distinct counts, deliberately not merged into one figure: rows still being funded
             this cycle but hidden by the display cap, versus projects the pool hasn't reached at
             all. Collapsing them would hide which is true of any given hidden project. They go in
             the footer slot, not among the rows, because the waiting count is at its most
             informative exactly when the funded list is EMPTY — a pool wholly absorbed by colonies,
             or no pool at all — and the empty state renders instead of the rows. */
          footer={
            <>
              {data.building.length > BUILDING_ROW_CAP && (
                <p className="px-3 py-1.5 text-[10px] text-text-tertiary">
                  {data.building.length - BUILDING_ROW_CAP} more funded this cycle, not shown
                </p>
              )}
              {data.waitingCount > 0 && (
                <p className="px-3 py-1.5 text-[10px] text-text-tertiary">
                  {data.waitingCount} more waiting on the pool
                </p>
              )}
            </>
          }
        >
          <ul>
            {/* Keyed on projectId, NOT systemId — a system routinely runs several concurrent build
                projects, so systemId repeats within this list. A systemId key here breaks React's
                reconciliation: duplicate keys leave stale rows behind and pile up new ones every
                re-render instead of replacing them (see TrackerBuildRow's docstring). */}
            {data.building.slice(0, BUILDING_ROW_CAP).map((row) => (
              <TrackerRow
                key={row.projectId}
                systemId={row.systemId}
                name={`${row.systemName} · ${row.label}`}
                figures={etaFigures(row)}
                progress={row.progress}
                nextCycleProgress={row.nextCycleProgress}
                tone="build"
                onActivate={() => activate(row.systemId, "industry")}
                cardLabel={projectCardLabel(row, "Building")}
                card={<ProjectCard row={row} kind="Building" />}
              />
            ))}
          </ul>
        </TrackerSection>
      )}

      {sections.colonising && (
        <TrackerSection title="Colonising" count={data.colonising.length} emptyMessage="No colonies forming.">
          <ul>
            {/* Keyed on systemId — safe here (unlike Building above): a system can never carry two
                concurrent colony_establish projects, so systemId is unique within this list
                (see TrackerColonyRow's docstring). Don't "fix" this to match Building's key. */}
            {data.colonising.map((row) => (
              <TrackerRow
                key={row.systemId}
                systemId={row.systemId}
                name={row.systemName}
                figures={etaFigures(row)}
                progress={row.progress}
                nextCycleProgress={row.nextCycleProgress}
                tone="colony"
                onActivate={() => activate(row.systemId, "")}
                cardLabel={projectCardLabel(row, "Colonising")}
                card={<ProjectCard row={row} kind="Colonising" />}
              />
            ))}
          </ul>
        </TrackerSection>
      )}
    </div>
  );
}

function TrackerSection({
  title,
  count,
  emptyMessage,
  footer,
  children,
}: {
  title: string;
  count: number;
  emptyMessage: string;
  /** Summary lines that describe the section as a whole rather than its rows — rendered whatever
   *  `count` is, unlike `children`, which the empty state replaces. A count of what is NOT in the
   *  list is at its most informative when the list is empty. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <SectionHeader as="h3" className="px-3 pt-2 pb-1">
        {title} — {count}
      </SectionHeader>
      {count === 0 ? <EmptyState message={emptyMessage} className="py-3" /> : children}
      {footer}
    </section>
  );
}

/** Population + stability, the two figures the spec assigns to a pinned row — the same source
 *  (`TrackerPinnedRow`) that feeds `PinnedCard`'s table, so the two can't disagree. */
function pinnedFigures(row: TrackerPinnedRow): TrackerFigure[] {
  return [
    { icon: <PersonIcon className="h-3.5 w-3.5" />, label: "Population", value: formatPeople(row.population) },
    { label: "Stability", value: `${Math.round(row.stabilityPct)}%`, swatchColor: stabilityRampColor(row.unrest) },
  ];
}

/** The one figure a build or colony row carries: time remaining, right-aligned in the same slot a
 *  pinned row spends on population and stability. Row and card both go through `formatEta` on the
 *  same `etaCycles`, so the two registers cannot disagree — including "stalled" for a project with
 *  no forecast, a colony the pool has not reached this cycle having no rate to divide by. It stays
 *  in the row's ordinary grey: the Tracker is a quiet list, and calling out trouble is the alert
 *  bar's job, not a colour on every stalled row.
 *
 *  Typed on `TrackerRowBase` rather than `TrackerBuildRow | TrackerColonyRow`: this only ever reads
 *  base fields, and `TrackerColonyRow` is itself a bare alias of `TrackerRowBase`, so the union
 *  constrained nothing a caller could rely on. */
function etaFigures(row: TrackerRowBase): TrackerFigure[] {
  return [{ label: "Time remaining", value: formatEta(row.etaCycles) }];
}

/** A project card's accessible name. A card is a `dialog` to a screen reader, and an unnamed
 *  dialog announces as bare "dialog" — which is all a keyboard user entering by ArrowDown would
 *  hear. Built here rather than inside `ProjectCard` so the name and the card's own heading come
 *  off the same row in the same place. */
function projectCardLabel(row: TrackerRowBase, kind: "Building" | "Colonising"): string {
  return `${kind}: ${row.systemName} · ${row.label}`;
}

/** A pinned row's card: the same vitals the system panel's Overview grid shows, plus the unpin
 *  control — the route from the Tracker, reachable by mouse and by keyboard alike (ArrowDown on the
 *  row enters the card). The star toggle in the system panel header,
 *  `components/system/pin-toggle.tsx`, is the same action's route from the system.
 *
 *  The unpin itself belongs to the panel, not to this card: it removes this very row, and where
 *  focus goes afterwards can only be decided by whoever holds the list (see `unpin` above).
 *
 *  Population against its cap lives here rather than on the row: the row carries at most two
 *  figures, and crowding that actually bites is the alert bar's to raise. */
function PinnedCard({ row, onUnpin }: { row: TrackerPinnedRow; onUnpin: () => void }) {
  return (
    <div>
      <h3 className="mb-2 font-display text-xs font-bold text-text-primary">{row.systemName}</h3>
      <StatList className="space-y-1.5">
        <StatRow label="Population">
          <span className="font-mono text-text-primary">{formatPeople(row.population)}</span>
        </StatRow>
        <StatRow label="Of capacity">
          <span className="font-mono text-text-primary">{Math.round(row.populationPct)}%</span>
        </StatRow>
        <StatRow label="Stability">
          <span className="font-mono text-text-primary">{Math.round(row.stabilityPct)}%</span>
        </StatRow>
        <StatRow label="Provisioned">
          {/* An em-dash for a system the economy has not assessed yet, exactly as the system panel's
              own Provisioned tile reads it — a 0% here would claim a measured famine. */}
          <span className="font-mono text-text-primary">
            {row.provisionPct !== null ? `${Math.round(row.provisionPct)}%` : "—"}
          </span>
        </StatRow>
        <StatRow label="Development">
          <span className="font-mono text-text-primary">{Math.round(row.developmentPct)}%</span>
        </StatRow>
      </StatList>
      <Button
        variant="outline"
        size="xs"
        fullWidth
        className="mt-3"
        onClick={onUnpin}
      >
        Unpin {row.systemName}
      </Button>
    </div>
  );
}

/** A build or colony row's card — the project figures already on `TrackerBuildRow` /
 *  `TrackerColonyRow`; no separate vitals fetch. A card describes its row's subject, and this row's
 *  subject is a project, not the system it sits in — vitals are a hover away on the system panel.
 *
 *  Typed on `TrackerRowBase` (see `etaFigures`'s docstring for why the union it replaces constrained
 *  nothing); `kind` is the real discriminant, passed explicitly by the caller rather than inferred
 *  from the row's shape. */
function ProjectCard({ row, kind }: { row: TrackerRowBase; kind: "Building" | "Colonising" }) {
  return (
    <div>
      <h3 className="mb-2 font-display text-xs font-bold text-text-primary">{row.systemName}</h3>
      <StatList className="space-y-1.5">
        <StatRow label={kind}>
          <span className="text-text-primary">{row.label}</span>
        </StatRow>
        <StatRow label="Progress">
          {/* Same tested helper the bar's width uses — one definition of fraction → percent, so the
              card's number and the bar it describes can never drift apart or repeat the units bug. */}
          <span className="font-mono text-text-primary">{Math.round(barWidthPct(row.progress))}%</span>
        </StatRow>
        <StatRow label="ETA">
          <span className="font-mono text-text-primary">{formatEta(row.etaCycles)}</span>
        </StatRow>
      </StatList>
    </div>
  );
}
