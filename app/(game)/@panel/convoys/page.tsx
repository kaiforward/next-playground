"use client";

import { useMemo } from "react";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { useFleet } from "@/lib/hooks/use-fleet";
import { withCounts } from "@/lib/utils/filter";
import { ConvoyDetailCard } from "@/components/fleet/convoy-detail-card";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useFilterState } from "@/lib/hooks/use-filter-state";
import type { ConvoyState } from "@/lib/types/game";

const FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "docked", label: "Docked" },
  { id: "in_transit", label: "In Transit" },
];

const SORT_OPTIONS = [
  { id: "name", label: "Name" },
  { id: "ships", label: "Ship count" },
  { id: "status", label: "Status" },
];

function sortConvoys(convoys: ConvoyState[], sortBy: string): ConvoyState[] {
  return [...convoys].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return (a.name ?? "Convoy").localeCompare(b.name ?? "Convoy");
      case "ships":
        return b.members.length - a.members.length;
      case "status":
        return a.status.localeCompare(b.status);
      default:
        return 0;
    }
  });
}

function ConvoysContent() {
  const { convoys } = useConvoys();
  const { fleet } = useFleet();
  const { activeChips, toggleChip, searchValue, setSearchValue, activeSort, setActiveSort } =
    useFilterState({ defaultSort: "name" });

  const filtered = useMemo(() => {
    let result = convoys;

    if (!activeChips.includes("all")) {
      result = result.filter((c) => activeChips.includes(c.status));
    }

    if (searchValue.trim()) {
      const q = searchValue.toLowerCase();
      result = result.filter((c) =>
        (c.name ?? "Convoy").toLowerCase().includes(q),
      );
    }

    return sortConvoys(result, activeSort ?? "name");
  }, [convoys, activeChips, searchValue, activeSort]);

  const chipsWithCounts = useMemo(
    () => withCounts(FILTER_CHIPS, convoys, (c) => c.status),
    [convoys],
  );

  return (
    <>
      <FilterBar
        chips={chipsWithCounts}
        activeChips={activeChips}
        onChipToggle={toggleChip}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search convoys..."
        sortOptions={SORT_OPTIONS}
        activeSort={activeSort}
        onSortChange={setActiveSort}
        resultCount={{ shown: filtered.length, total: convoys.length }}
      />

      {filtered.length === 0 ? (
        <EmptyState
          message={convoys.length === 0 ? "No convoys formed yet." : "No convoys match this filter."}
          className="py-16"
        />
      ) : (
        <div className="space-y-4">
          {filtered.map((convoy) => (
            <ConvoyDetailCard
              key={convoy.id}
              convoy={convoy}
              playerCredits={fleet.credits}
              ships={fleet.ships}
              variant="summary"
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function ConvoysPanelPage() {
  return (
    <DetailPanel title="Convoys" size="lg">
      <QueryBoundary>
        <ConvoysContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
