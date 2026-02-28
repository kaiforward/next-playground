"use client";

import { useMemo } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ShipCard } from "@/components/fleet/ship-card";
import { DetailPanel } from "@/components/ui/detail-panel";
import { FilterBar } from "@/components/ui/filter-bar";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useFilterState } from "@/lib/hooks/use-filter-state";
import type { ShipState } from "@/lib/types/game";

const FILTER_CHIPS = [
  { id: "all", label: "All" },
  { id: "docked", label: "Docked" },
  { id: "in_transit", label: "In Transit" },
  { id: "disabled", label: "Disabled" },
];

const SORT_OPTIONS = [
  { id: "name", label: "Name" },
  { id: "class", label: "Class" },
  { id: "location", label: "Location" },
];

function sortShips(ships: ShipState[], sortBy: string): ShipState[] {
  return [...ships].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "class":
        return a.shipType.localeCompare(b.shipType);
      case "location":
        return a.system.name.localeCompare(b.system.name);
      default:
        return 0;
    }
  });
}

function FleetContent() {
  const { fleet } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();
  const { activeChips, toggleChip, searchValue, setSearchValue, activeSort, setActiveSort } =
    useFilterState({ defaultSort: "name" });

  const filtered = useMemo(() => {
    let result = fleet.ships;

    // Status filter
    if (!activeChips.includes("all")) {
      result = result.filter((s) => {
        if (activeChips.includes("docked") && s.status === "docked" && !s.disabled) return true;
        if (activeChips.includes("in_transit") && s.status === "in_transit") return true;
        if (activeChips.includes("disabled") && s.disabled) return true;
        return false;
      });
    }

    // Search by name
    if (searchValue.trim()) {
      const q = searchValue.toLowerCase();
      result = result.filter((s) => s.name.toLowerCase().includes(q));
    }

    return sortShips(result, activeSort ?? "name");
  }, [fleet.ships, activeChips, searchValue, activeSort]);

  const chipsWithCounts = useMemo(
    () =>
      FILTER_CHIPS.map((chip) => ({
        ...chip,
        count:
          chip.id === "all"
            ? fleet.ships.length
            : chip.id === "disabled"
              ? fleet.ships.filter((s) => s.disabled).length
              : fleet.ships.filter((s) => s.status === chip.id && !s.disabled).length,
      })),
    [fleet.ships],
  );

  return (
    <>
      <FilterBar
        chips={chipsWithCounts}
        activeChips={activeChips}
        onChipToggle={toggleChip}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        searchPlaceholder="Search ships..."
        sortOptions={SORT_OPTIONS}
        activeSort={activeSort}
        onSortChange={setActiveSort}
        resultCount={{ shown: filtered.length, total: fleet.ships.length }}
      />

      {filtered.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-text-muted text-sm">
          No ships match this filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((ship) => (
            <ShipCard
              key={ship.id}
              ship={ship}
              currentTick={currentTick}
              regions={universeData.regions}
              playerCredits={fleet.credits}
            />
          ))}
        </div>
      )}
    </>
  );
}

export default function FleetPanelPage() {
  return (
    <DetailPanel title="Fleet" size="lg">
      <QueryBoundary>
        <FleetContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
