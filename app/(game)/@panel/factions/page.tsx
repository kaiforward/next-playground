"use client";

import { useMemo } from "react";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FilterBar } from "@/components/ui/filter-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useFactions } from "@/lib/hooks/use-factions";
import { useFilterState } from "@/lib/hooks/use-filter-state";
import { withCounts } from "@/lib/utils/filter";
import { FactionCard } from "@/components/factions/faction-card";
import type { FactionStatus } from "@/lib/types/game";
import type { FactionSummary } from "@/lib/services/factions";

const FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "dominant", label: "Dominant" },
  { id: "major", label: "Major" },
  { id: "regional", label: "Regional" },
  { id: "minor", label: "Minor" },
];

const SORT_OPTIONS = [
  { id: "territory", label: "Territory" },
  { id: "name", label: "Name" },
  { id: "government", label: "Government" },
];

const STATUS_RANK: Record<FactionStatus, number> = {
  dominant: 0,
  major: 1,
  regional: 2,
  minor: 3,
};

function sortFactions(factions: FactionSummary[], sortBy: string): FactionSummary[] {
  return [...factions].sort((a, b) => {
    switch (sortBy) {
      case "territory":
        return b.territorySize - a.territorySize;
      case "name":
        return a.name.localeCompare(b.name);
      case "government":
        return a.governmentName.localeCompare(b.governmentName);
      default:
        return STATUS_RANK[a.status] - STATUS_RANK[b.status];
    }
  });
}

function FactionsContent() {
  const { factions } = useFactions();
  const { activeChips, toggleChip, searchValue, setSearchValue, activeSort, setActiveSort } =
    useFilterState({ defaultSort: "territory" });

  const filtered = useMemo(() => {
    let result = factions;

    if (!activeChips.includes("all")) {
      result = result.filter((f) => activeChips.includes(f.status));
    }

    if (searchValue.trim()) {
      const q = searchValue.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.governmentName.toLowerCase().includes(q) ||
          f.doctrineName.toLowerCase().includes(q),
      );
    }

    return sortFactions(result, activeSort ?? "territory");
  }, [factions, activeChips, searchValue, activeSort]);

  const chipsWithCounts = useMemo(
    () => withCounts(FILTER_CHIPS, factions, (f) => f.status),
    [factions],
  );

  return (
    <>
      <FilterBar
        chips={chipsWithCounts}
        activeChips={activeChips}
        onChipToggle={toggleChip}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search factions..."
        sortOptions={SORT_OPTIONS}
        activeSort={activeSort}
        onSortChange={setActiveSort}
        resultCount={{ shown: filtered.length, total: factions.length }}
      />

      {filtered.length === 0 ? (
        <EmptyState message="No factions match this filter." className="py-16" />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map((faction) => (
            <FactionCard
              key={faction.id}
              faction={faction}
              size="sm"
              href={`/factions/${faction.id}`}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function FactionsPanelPage() {
  return (
    <DetailPanel
      title="Factions"
      subtitle="Powers of the known galaxy — governments, doctrines, and territory."
    >
      <QueryBoundary>
        <FactionsContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
