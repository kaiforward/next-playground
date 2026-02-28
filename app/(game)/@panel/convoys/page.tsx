"use client";

import { useMemo } from "react";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { ConvoyStatus } from "@/components/fleet/convoy-status";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FilterBar } from "@/components/ui/filter-bar";
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
    () =>
      FILTER_CHIPS.map((chip) => ({
        ...chip,
        count:
          chip.id === "all"
            ? convoys.length
            : convoys.filter((c) => c.status === chip.id).length,
      })),
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
        <div className="flex items-center justify-center py-16 text-text-muted text-sm">
          {convoys.length === 0 ? "No convoys formed yet." : "No convoys match this filter."}
        </div>
      ) : (
        <ConvoyStatus convoys={filtered} />
      )}
    </>
  );
}

export default function ConvoysPanelPage() {
  return (
    <DetailPanel title="Convoys">
      <QueryBoundary>
        <ConvoysContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
