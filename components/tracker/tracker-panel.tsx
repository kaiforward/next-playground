"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTracker } from "@/lib/hooks/use-tracker";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { useSetSystemPin } from "@/lib/hooks/use-player-pins";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { progressWidthPct } from "@/lib/utils/math";
import { PersonIcon, SettingsIcon } from "@/components/ui/icons";
import { TrackerRow, type TrackerFigure } from "@/components/tracker/tracker-row";
import { stabilityRampColor } from "@/lib/utils/stability";
import { formatPeople } from "@/lib/utils/format";
import type { TrackerBuildRow, TrackerColonyRow, TrackerPinnedRow } from "@/lib/types/api";
import type { TrackerSections } from "@/lib/hooks/use-tracker-sections";

/** Building-row display cap (docs/planned/tracker.md → "Rows and the card": a dozen rows are
 *  scannable, hundreds are not). The funded front can run to dozens of parallel projects in a real
 *  game; only the first `BUILDING_ROW_CAP` in queue order render, and the rest are named in the
 *  summary line rather than dropped silently. */
const BUILDING_ROW_CAP = 10;

export interface TrackerPanelProps {
  /** Which of the three sections to render — a section's rows AND its heading disappear
   *  together when off (`components/tracker/tracker-settings.tsx`'s checkboxes write this via
   *  `useTrackerSections()`, owned by `MapRightRail`). */
  sections: TrackerSections;
  /** Pressed-state for the header's settings toggle — the settings panel itself is a sibling
   *  `MapRightRail` mounts conditionally, not something this component renders. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

/**
 * The Tracker panel (docs/active/gameplay/tracker.md) — pinned systems, the player faction's
 * funded construction front, and its forming colonies. Owns `useTracker()` inside a
 * `QueryBoundary` so a fetch failure here degrades the panel, not the map behind it.
 *
 * The header — title plus the settings toggle button — always renders regardless of `sections`,
 * so the settings surface stays reachable even with every section hidden.
 *
 * Mounted from `components/map/map-right-rail.tsx`, as the right-hand member of the horizontal
 * pair it shares with `TrackerSettings` (rendered as its sibling to the left, when open) inside
 * the right-edge column's upper region, above `MapControlsDock`. `h-full min-h-0` here is what
 * lets it stretch to fill whatever height the shared row is given and still shrink internally —
 * see the layout note on `MapRightRail` — with `TrackerPanelContent`'s own `overflow-y-auto`
 * taking over from that point, no measured/guessed max-height.
 */
export function TrackerPanel({ sections, settingsOpen, onToggleSettings }: TrackerPanelProps) {
  return (
    <div className="pointer-events-auto flex h-full min-h-0 w-72 shrink-0 flex-col border border-border bg-surface/95 shadow-lg backdrop-blur">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
          Tracker
        </h2>
        <Button
          variant="ghost"
          size="iconXs"
          aria-pressed={settingsOpen}
          aria-label="Tracker settings"
          onClick={onToggleSettings}
        >
          <SettingsIcon aria-hidden className="h-3.5 w-3.5" />
        </Button>
      </div>
      <QueryBoundary>
        <TrackerPanelContent sections={sections} />
      </QueryBoundary>
    </div>
  );
}

function TrackerPanelContent({ sections }: { sections: TrackerSections }) {
  const data = useTracker();
  const { atlas } = useAtlas();
  const router = useRouter();
  // Monotonic per-panel nonce for `?loc=` — only needs to differ from its own previous value so
  // the map's focus effect (keyed on `focus|loc`, see star-map.tsx) re-fires even when locating
  // the same system twice in a row.
  const locRef = useRef(0);

  const coordsById = useMemo(
    () => new Map(atlas.systems.map((s) => [s.id, { x: s.x, y: s.y }] as const)),
    [atlas.systems],
  );

  function activate(systemId: string, segment: "" | "industry") {
    const coords = coordsById.get(systemId);
    if (!coords) return; // stale id (shouldn't happen — the service filters abandoned pins)
    locRef.current += 1;
    const path = segment ? `/system/${systemId}/${segment}` : `/system/${systemId}`;
    router.push(`${path}?focus=${coords.x},${coords.y}&loc=${locRef.current}`);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {/* Hiding a section (TrackerSettings) drops its heading along with its rows — it is not
          rendered at all rather than rendered empty, per docs/planned/tracker.md → "Settings". */}
      {sections.pinned && (
        <TrackerSection title="Pinned" count={data.pinned.length} emptyMessage="No pinned systems yet.">
          <ul>
            {/* Keyed on systemId — safe here because pinnedSystemIds is deduped (a bookmark set, not a
                project list), unlike the Building list below. */}
            {data.pinned.map((row) => (
              <TrackerRow
                key={row.systemId}
                systemId={row.systemId}
                name={row.systemName}
                figures={pinnedFigures(row)}
                onActivate={() => activate(row.systemId, "")}
                card={<PinnedCard row={row} />}
              />
            ))}
          </ul>
        </TrackerSection>
      )}

      {sections.building && (
        <>
          <TrackerSection title="Building" count={data.building.length} emptyMessage="Nothing funded this cycle.">
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
                  figures={[]}
                  progress={row.progress}
                  tone="build"
                  onActivate={() => activate(row.systemId, "industry")}
                  card={<ProjectCard row={row} kind="Building" />}
                />
              ))}
            </ul>
            {/* Two distinct counts, deliberately not merged into one figure: rows still being funded
                this cycle but hidden by the display cap, versus projects the pool hasn't reached at
                all. Collapsing them would hide which is true of any given hidden project. */}
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
          </TrackerSection>
        </>
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
                figures={[]}
                progress={row.progress}
                tone="colony"
                onActivate={() => activate(row.systemId, "")}
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
  children,
}: {
  title: string;
  count: number;
  emptyMessage: string;
  children: ReactNode;
}) {
  return (
    <section>
      <SectionHeader as="h3" className="px-3 pt-2 pb-1">
        {title} — {count}
      </SectionHeader>
      {count === 0 ? <EmptyState message={emptyMessage} className="py-3" /> : children}
    </section>
  );
}

/** Population + stability, the two figures the spec assigns to a pinned row — the same source
 *  (`TrackerPinnedRow`) that feeds `PinnedCard`'s table, so the two can't disagree. */
function pinnedFigures(row: TrackerPinnedRow): TrackerFigure[] {
  const unrest = 1 - row.stabilityPct / 100;
  return [
    { icon: <PersonIcon className="h-3.5 w-3.5" />, label: "Population", value: formatPeople(row.population) },
    { label: "Stability", value: `${Math.round(row.stabilityPct)}%`, swatchColor: stabilityRampColor(unrest) },
  ];
}

/** A pinned row's card: the same vitals the system panel's Overview grid shows, plus the unpin
 *  control — the mouse-convenience route (the star toggle in the system header, Task 6, is the
 *  keyboard route and works either way). */
function PinnedCard({ row }: { row: TrackerPinnedRow }) {
  const setPin = useSetSystemPin();
  return (
    <div>
      <h3 className="mb-2 font-display text-xs font-bold text-text-primary">{row.systemName}</h3>
      <StatList className="space-y-1.5">
        <StatRow label="Population">
          <span className="font-mono text-text-primary">{formatPeople(row.population)}</span>
        </StatRow>
        <StatRow label="Stability">
          <span className="font-mono text-text-primary">{Math.round(row.stabilityPct)}%</span>
        </StatRow>
        <StatRow label="Provisioned">
          <span className="font-mono text-text-primary">{Math.round(row.provisionPct)}%</span>
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
        onClick={() => setPin.mutate({ systemId: row.systemId, pinned: false })}
      >
        Unpin {row.systemName}
      </Button>
    </div>
  );
}

/** A build or colony row's card — the funded-front figures already on `TrackerBuildRow` /
 *  `TrackerColonyRow`; no separate vitals fetch (that data belongs to the pinned read, Task 3). */
function ProjectCard({ row, kind }: { row: TrackerBuildRow | TrackerColonyRow; kind: "Building" | "Colonising" }) {
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
          <span className="font-mono text-text-primary">{Math.round(progressWidthPct(row.progress))}%</span>
        </StatRow>
        <StatRow label="ETA">
          <span className="font-mono text-text-primary">
            {row.etaCycles !== null ? `${row.etaCycles} cyc` : "—"}
          </span>
        </StatRow>
      </StatList>
    </div>
  );
}
