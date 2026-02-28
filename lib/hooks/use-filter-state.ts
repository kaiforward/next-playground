"use client";

import { useState, useCallback } from "react";

interface UseFilterStateConfig {
  defaultChips?: string[];
  defaultSort?: string;
}

export function useFilterState(config: UseFilterStateConfig = {}) {
  const [activeChips, setActiveChips] = useState<string[]>(config.defaultChips ?? ["all"]);
  const [searchValue, setSearchValue] = useState("");
  const [activeSort, setActiveSort] = useState<string | undefined>(config.defaultSort);

  const toggleChip = useCallback((id: string) => {
    setActiveChips((prev) => {
      // "all" is exclusive — selecting it clears other chips
      if (id === "all") return ["all"];
      // Selecting a non-all chip removes "all"
      const withoutAll = prev.filter((c) => c !== "all");
      const isActive = withoutAll.includes(id);
      const next = isActive ? withoutAll.filter((c) => c !== id) : [...withoutAll, id];
      // If nothing selected, revert to "all"
      return next.length === 0 ? ["all"] : next;
    });
  }, []);

  return {
    activeChips,
    toggleChip,
    searchValue,
    setSearchValue,
    activeSort,
    setActiveSort,
  };
}
