"use client";

import { useMemo } from "react";
import { SelectInput } from "@/components/form/select-input";
import { Button } from "@/components/ui/button";

interface MapPricePanelProps {
  /** Selected good for the heatmap. Null until one is picked. */
  priceGoodId: string | null;
  setPriceGoodId: (goodId: string | null) => void;
  /** Sorted goods list for the picker. */
  goods: { id: string; name: string }[];
  /** Open the cross-system comparison panel. Shown only once a good is picked. */
  onOpenComparisonTable: () => void;
}

/**
 * Interactive controls for the Price overlay — a good-picker and a jump to the
 * cross-system comparison panel. A standalone floating panel (positioned by the
 * dock, [map-controls-dock.tsx]) so picking a good never reflows the main panel.
 * The price-ramp legend itself lives on the Price overlay chip's hover tooltip.
 */
export function MapPricePanel({
  priceGoodId,
  setPriceGoodId,
  goods,
  onOpenComparisonTable,
}: MapPricePanelProps) {
  const options = useMemo<{ value: string | null; label: string }[]>(
    () => [
      { value: null, label: "Select a good…" },
      ...goods.map((g) => ({ value: g.id, label: g.name })),
    ],
    [goods]
  );
  return (
    <div className="w-44 border border-border bg-surface/95 backdrop-blur shadow-lg">
      <div className="px-3 py-2 border-b border-border">
        <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.18em] text-text-secondary">
          Price
        </h3>
      </div>
      <div className="px-3 py-2 space-y-2">
        <SelectInput<string | null>
          label="Good"
          size="sm"
          options={options}
          value={priceGoodId}
          onChange={setPriceGoodId}
          valueKey={(v) => v ?? ""}
          isSearchable
        />
        {priceGoodId && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            fullWidth
            onClick={onOpenComparisonTable}
          >
            Show all prices
          </Button>
        )}
      </div>
    </div>
  );
}
