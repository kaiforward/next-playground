"use client";

import { useMemo } from "react";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { EventIcon } from "@/components/events/event-icon";
import { useEvents } from "@/lib/hooks/use-events";
import { useFilterState } from "@/lib/hooks/use-filter-state";
import { EVENT_TYPE_BADGE_COLOR } from "@/lib/constants/ui";
import type { ActiveEvent } from "@/lib/types/game";
import { formatDuration } from "@/lib/utils/calendar";
import { useLinkComponent } from "@/components/ui/link-provider";

const SORT_OPTIONS = [
  { id: "ticks", label: "Time remaining" },
  { id: "system", label: "System name" },
];

function sortEvents(events: ActiveEvent[], sortBy: string): ActiveEvent[] {
  return [...events].sort((a, b) => {
    switch (sortBy) {
      case "ticks":
        return a.ticksRemaining - b.ticksRemaining;
      case "system":
        return (a.systemName ?? "").localeCompare(b.systemName ?? "");
      default:
        return 0;
    }
  });
}

/** Moved from `app/(game)/@panel/factions/[factionId]/events/page.tsx` — the galaxy-wide
 *  active-events feed, not scoped to the faction whose panel hosts it. Post-strip the only
 *  events left are the relations-owned diplomacy arcs, so this is a plain sortable list —
 *  no type filter, no severity sort (both dropped with the random-spawn content they served). */
export function FactionEvents() {
  const { events } = useEvents();
  const { activeSort, setActiveSort } = useFilterState({ defaultSort: "ticks" });
  const LinkComponent = useLinkComponent();

  const sorted = useMemo(
    () => sortEvents(events, activeSort ?? "ticks"),
    [events, activeSort],
  );

  return (
    <>
      <FilterBar
        sortOptions={SORT_OPTIONS}
        activeSort={activeSort}
        onSortChange={setActiveSort}
      />

      {sorted.length === 0 ? (
        <EmptyState message="No active events." className="py-16" />
      ) : (
        <ul className="space-y-2">
          {sorted.map((event) => (
            <li
              key={event.id}
              className="flex items-start gap-3 py-3 px-3 bg-surface-hover/40 hover:bg-surface-hover border-l-2 border-l-accent transition-colors"
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
                {event.effects && (
                  <p className="text-xs text-text-secondary mt-0.5">{event.effects}</p>
                )}
                {event.systemName && (
                  <LinkComponent
                    href={`/system/${event.systemId}`}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-0.5 inline-block"
                  >
                    {event.systemName}
                  </LinkComponent>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs font-mono text-text-primary">
                  {formatDuration(event.ticksRemaining)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
