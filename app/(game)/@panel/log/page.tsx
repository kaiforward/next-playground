"use client";

import { useState, useMemo } from "react";
import { DetailPanel } from "@/components/ui/detail-panel";
import { LogEntry } from "@/components/notifications/log-entry";
import { useLog } from "@/lib/hooks/use-log";
import type { NotificationType } from "@/lib/types/game";

const FILTER_CHIPS: Array<{ id: string; label: string; types: NotificationType[] }> = [
  { id: "all", label: "All", types: [] },
  {
    id: "trade",
    label: "Trade",
    types: ["import_duty", "contraband_seized"],
  },
  {
    id: "combat",
    label: "Combat",
    types: ["battle_round", "battle_won", "battle_lost"],
  },
  {
    id: "fleet",
    label: "Fleet",
    types: ["ship_arrived", "ship_damaged", "ship_disabled", "cargo_lost", "hazard_incident"],
  },
  {
    id: "missions",
    label: "Missions",
    types: ["mission_completed", "mission_expired"],
  },
];

export default function LogPanelPage() {
  const [activeFilter, setActiveFilter] = useState("all");

  const selectedTypes = useMemo(() => {
    const chip = FILTER_CHIPS.find((c) => c.id === activeFilter);
    return chip?.types.length ? chip.types : undefined;
  }, [activeFilter]);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } =
    useLog({ types: selectedTypes });

  const notifications = useMemo(
    () => data?.pages.flatMap((p) => p.notifications) ?? [],
    [data],
  );

  return (
    <DetailPanel title="Captain's Log" size="md">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            onClick={() => setActiveFilter(chip.id)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              activeFilter === chip.id
                ? "bg-accent/20 border-accent text-accent"
                : "border-border text-text-secondary hover:text-text-primary hover:border-border-hover"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-text-muted text-sm">
          Loading...
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center py-16 text-red-400 text-sm">
          Failed to load notifications.
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-text-muted text-sm">
          No log entries match this filter.
        </div>
      ) : (
        <div className="divide-y divide-border -mx-6">
          {notifications.map((n) => (
            <LogEntry key={n.id} notification={n} />
          ))}
        </div>
      )}

      {/* Show more */}
      {hasNextPage && (
        <div className="flex justify-center mt-4">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-4 py-2 text-xs text-accent border border-accent/30 rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
          >
            {isFetchingNextPage ? "Loading..." : "Show more"}
          </button>
        </div>
      )}
    </DetailPanel>
  );
}
