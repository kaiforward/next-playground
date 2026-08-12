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
import { PersonIcon } from "@/components/ui/icons";
import { TrackerRow, type TrackerFigure } from "@/components/tracker/tracker-row";
import { stabilityRampColor } from "@/lib/utils/stability";
import { formatPeople } from "@/lib/utils/format";
import type { TrackerBuildRow, TrackerColonyRow, TrackerPinnedRow } from "@/lib/types/api";

/**
 * The Tracker panel (docs/active/gameplay/tracker.md) — pinned systems, the player faction's
 * funded construction front, and its forming colonies. No props; owns `useTracker()` inside a
 * `QueryBoundary` so a fetch failure here degrades the panel, not the map behind it.
 *
 * Mounted from `components/map/map-right-rail.tsx`, as the top child of the right-edge column it
 * shares with `MapControlsDock` (see the note there). `flex-1 min-h-0` here is what lets it shrink
 * to whatever space the dock leaves below it, with `TrackerPanelContent`'s own `overflow-y-auto`
 * taking over from that point — no measured/guessed max-height.
 */
export function TrackerPanel() {
  return (
    <div className="pointer-events-auto flex min-h-0 w-72 flex-1 flex-col border border-border bg-surface/95 shadow-lg backdrop-blur">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <h2 className="font-display text-[10px] font-bold uppercase tracking-[0.18em] text-text-secondary">
          Tracker
        </h2>
      </div>
      <QueryBoundary>
        <TrackerPanelContent />
      </QueryBoundary>
    </div>
  );
}

function TrackerPanelContent() {
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
      <TrackerSection title="Pinned" count={data.pinned.length} emptyMessage="No pinned systems yet.">
        <ul>
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

      <TrackerSection title="Building" count={data.building.length} emptyMessage="Nothing funded this cycle.">
        <ul>
          {data.building.map((row) => (
            <TrackerRow
              key={row.systemId}
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
        {data.waitingCount > 0 && (
          <p className="px-3 py-1.5 text-[10px] text-text-tertiary">
            {data.waitingCount} more waiting on the pool
          </p>
        )}
      </TrackerSection>

      <TrackerSection title="Colonising" count={data.colonising.length} emptyMessage="No colonies forming.">
        <ul>
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
          <span className="font-mono text-text-primary">{Math.round(row.progress)}%</span>
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
