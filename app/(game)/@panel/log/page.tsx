"use client";

import { useMemo } from "react";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadMoreFooter } from "@/components/ui/load-more-footer";
import { LoadingFallback } from "@/components/ui/loading-fallback";
import { ErrorFallback } from "@/components/ui/error-fallback";
import { LogEntry } from "@/components/notifications/log-entry";
import { usePaginatedQuery } from "@/lib/hooks/use-paginated-query";
import { useFilterState } from "@/lib/hooks/use-filter-state";
import { queryKeys } from "@/lib/query/keys";
import type { PlayerNotificationInfo, NotificationType } from "@/lib/types/game";

const FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "trade", label: "Trade" },
  { id: "combat", label: "Combat" },
  { id: "fleet", label: "Fleet" },
  { id: "missions", label: "Missions" },
] as const;

type LogChipId = (typeof FILTER_CHIPS)[number]["id"];

const CHIP_TYPE_MAP: Record<Exclude<LogChipId, "all">, NotificationType[]> = {
  trade: ["import_duty", "contraband_seized"],
  combat: ["battle_round", "battle_won", "battle_lost"],
  fleet: ["ship_arrived", "ship_damaged", "ship_disabled", "cargo_lost", "hazard_incident"],
  missions: ["mission_completed", "mission_expired"],
};

function isFilterChip(id: string): id is Exclude<LogChipId, "all"> {
  return id in CHIP_TYPE_MAP;
}

function chipIdsToTypes(chipIds: string[]): NotificationType[] | undefined {
  if (chipIds.includes("all")) return undefined;
  const types = chipIds.filter(isFilterChip).flatMap((id) => CHIP_TYPE_MAP[id]);
  return types.length > 0 ? types : undefined;
}

export default function LogPanelPage() {
  const { activeChips, toggleChip, searchValue, setSearchValue } = useFilterState();

  const types = useMemo(() => chipIdsToTypes(activeChips), [activeChips]);

  const filters = useMemo(
    () => (types ? { types } : undefined),
    [types],
  );

  const { items, total, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, error, refetch } =
    usePaginatedQuery<PlayerNotificationInfo, { types: NotificationType[] }>({
      queryKey: queryKeys.notifications,
      endpoint: "/api/game/notifications",
      filters,
      search: searchValue || undefined,
      limit: 30,
    });

  return (
    <DetailPanel title="Captain's Log" size="md">
      <FilterBar
        chips={FILTER_CHIPS}
        activeChips={activeChips}
        onChipToggle={toggleChip}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search log entries..."
        resultCount={!isLoading && !isError ? { shown: items.length, total } : undefined}
      />

      {isLoading ? (
        <LoadingFallback message="Loading log..." />
      ) : isError ? (
        <ErrorFallback
          error={error ?? new Error("Failed to load log entries.")}
          onRetry={refetch}
        />
      ) : items.length === 0 ? (
        <EmptyState message="No log entries match this filter." className="py-16" />
      ) : (
        <div className="divide-y divide-border -mx-6">
          {items.map((n) => (
            <LogEntry key={n.id} notification={n} />
          ))}
        </div>
      )}

      <LoadMoreFooter
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        onLoadMore={fetchNextPage}
      />
    </DetailPanel>
  );
}
