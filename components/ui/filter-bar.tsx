"use client";

interface FilterChip {
  id: string;
  label: string;
  count?: number;
}

interface SortOption {
  id: string;
  label: string;
}

interface FilterBarProps {
  chips: FilterChip[];
  activeChips: string[];
  onChipToggle: (id: string) => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  sortOptions?: SortOption[];
  activeSort?: string;
  onSortChange?: (id: string) => void;
  resultCount?: { shown: number; total: number };
}

export function FilterBar({
  chips,
  activeChips,
  onChipToggle,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  sortOptions,
  activeSort,
  onSortChange,
  resultCount,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const active = activeChips.includes(chip.id);
          return (
            <button
              key={chip.id}
              onClick={() => onChipToggle(chip.id)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                active
                  ? "bg-accent/20 border-accent text-accent"
                  : "border-border text-text-secondary hover:text-text-primary hover:border-border-hover"
              }`}
            >
              {chip.label}
              {chip.count != null && (
                <span className="ml-1 opacity-70">{chip.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      {onSearchChange && (
        <div className="flex-1 min-w-[140px] max-w-[240px]">
          <input
            type="text"
            value={searchValue ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full px-2.5 py-1 text-xs bg-surface border border-border rounded text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      )}

      {/* Sort */}
      {sortOptions && sortOptions.length > 0 && onSortChange && (
        <select
          value={activeSort}
          onChange={(e) => onSortChange(e.target.value)}
          className="px-2 py-1 text-xs bg-surface border border-border rounded text-text-primary focus:outline-none focus:border-accent transition-colors"
        >
          {sortOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {/* Result count */}
      {resultCount && (
        <span className="text-xs text-text-muted ml-auto">
          {resultCount.shown} of {resultCount.total}
        </span>
      )}
    </div>
  );
}

export type { FilterChip, SortOption, FilterBarProps };
