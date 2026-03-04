"use client";

import { useMemo } from "react";
import Link from "next/link";
import { withCounts } from "@/lib/utils/filter";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { EventIcon } from "@/components/events/event-icon";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useEvents } from "@/lib/hooks/use-events";
import { useFilterState } from "@/lib/hooks/use-filter-state";
import { EVENT_TYPE_BADGE_COLOR, EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";
import type { ActiveEvent } from "@/lib/types/game";
import type { EventTypeId } from "@/lib/constants/events";

const FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "economic", label: "Economic" },
  { id: "conflict", label: "Conflict" },
  { id: "environmental", label: "Environmental" },
  { id: "social", label: "Social" },
];

const SORT_OPTIONS = [
  { id: "severity", label: "Severity" },
  { id: "ticks", label: "Ticks remaining" },
  { id: "system", label: "System name" },
];

const TYPE_CATEGORY: Record<EventTypeId, string> = {
  war: "conflict",
  conflict_spillover: "conflict",
  pirate_raid: "conflict",
  plague: "environmental",
  plague_risk: "environmental",
  solar_storm: "environmental",
  trade_festival: "social",
  mining_boom: "economic",
  ore_glut: "economic",
  supply_shortage: "economic",
};

function sortEvents(events: ActiveEvent[], sortBy: string): ActiveEvent[] {
  return [...events].sort((a, b) => {
    switch (sortBy) {
      case "severity": {
        const pa = EVENT_TYPE_DANGER_PRIORITY[a.type] ?? 0;
        const pb = EVENT_TYPE_DANGER_PRIORITY[b.type] ?? 0;
        return pb - pa;
      }
      case "ticks":
        return a.ticksRemaining - b.ticksRemaining;
      case "system":
        return (a.systemName ?? "").localeCompare(b.systemName ?? "");
      default:
        return 0;
    }
  });
}

function EventsContent() {
  const { events } = useEvents();
  const { activeChips, toggleChip, activeSort, setActiveSort } =
    useFilterState({ defaultSort: "severity" });

  const filtered = useMemo(() => {
    let result = events;
    if (!activeChips.includes("all")) {
      result = result.filter((e) => activeChips.includes(TYPE_CATEGORY[e.type] ?? ""));
    }
    return sortEvents(result, activeSort ?? "severity");
  }, [events, activeChips, activeSort]);

  const chipsWithCounts = useMemo(
    () => withCounts(FILTER_CHIPS, events, (e) => TYPE_CATEGORY[e.type] ?? ""),
    [events],
  );

  return (
    <>
      <FilterBar
        chips={chipsWithCounts}
        activeChips={activeChips}
        onChipToggle={toggleChip}
        sortOptions={SORT_OPTIONS}
        activeSort={activeSort}
        onSortChange={setActiveSort}
        resultCount={{ shown: filtered.length, total: events.length }}
      />

      {filtered.length === 0 ? (
        <EmptyState message="No active events match this filter." className="py-16" />
      ) : (
        <ul className="space-y-2">
          {filtered.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-3 py-3 px-3 rounded-lg bg-surface-hover/40 hover:bg-surface-hover transition-colors"
            >
              <div className="pt-0.5 shrink-0 text-text-secondary">
                <EventIcon eventType={event.type} className="w-4.5 h-4.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-text-primary">{event.name}</span>
                  <Badge color={EVENT_TYPE_BADGE_COLOR[event.type] ?? "slate"}>
                    {event.phaseDisplayName}
                  </Badge>
                </div>
                {event.systemName && (
                  <Link
                    href={`/system/${event.systemId}`}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-0.5 inline-block"
                  >
                    {event.systemName}
                  </Link>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono text-text-primary">
                  {event.ticksRemaining} ticks
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  Sev: {event.severity.toFixed(1)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function EventsPanelPage() {
  return (
    <DetailPanel title="Events" size="lg">
      <QueryBoundary>
        <EventsContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
