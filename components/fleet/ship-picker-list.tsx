"use client";

import { useState } from "react";
import type { ShipState } from "@/lib/types/game";
import { ROLE_COLORS } from "@/lib/constants/ships";
import { Badge } from "@/components/ui/badge";
import { TextInput } from "@/components/form/text-input";

interface ShipPickerListProps {
  ships: ShipState[];
  selected: Set<string>;
  onToggle: (shipId: string) => void;
  /** Show system name per row (useful when ships span multiple systems). */
  showSystem?: boolean;
  /** Tailwind max-height class. @default "max-h-64" */
  maxHeight?: string;
  /** Show filter input when ships.length >= N. @default 6 */
  filterThreshold?: number;
}

export function ShipPickerList({
  ships,
  selected,
  onToggle,
  showSystem,
  maxHeight = "max-h-64",
  filterThreshold = 6,
}: ShipPickerListProps) {
  const [filter, setFilter] = useState("");

  const filtered = filter
    ? ships.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
    : ships;

  return (
    <div className="space-y-2">
      {ships.length >= filterThreshold && (
        <TextInput
          size="sm"
          placeholder="Filter ships..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      <div className={`${maxHeight} overflow-y-auto space-y-1`}>
        {filtered.length === 0 && (
          <p className="text-xs text-text-muted py-2 text-center">No ships match filter.</p>
        )}
        {filtered.map((ship) => {
          const isSelected = selected.has(ship.id);
          return (
            <button
              key={ship.id}
              type="button"
              className={`w-full flex items-center gap-2 py-1.5 px-3 rounded text-left transition-colors ${
                isSelected
                  ? "border-l-2 border-blue-500 bg-blue-500/10"
                  : "border-l-2 border-transparent bg-surface hover:bg-surface-active"
              }`}
              onClick={() => onToggle(ship.id)}
            >
              <span className="text-sm text-text-primary truncate flex-1">{ship.name}</span>
              <Badge color={ROLE_COLORS[ship.role] ?? "slate"}>{ship.role}</Badge>
              <span className="text-xs text-text-muted whitespace-nowrap">{ship.cargoMax} cargo</span>
              {showSystem && (
                <span className="text-xs text-text-faint truncate max-w-24">{ship.system.name}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
