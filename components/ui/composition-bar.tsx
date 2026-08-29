import {
  compositionSegmentWidths,
  type CompositionSegment,
} from "@/components/ui/composition-bar-helpers";

export type { CompositionSegment } from "@/components/ui/composition-bar-helpers";

export interface CompositionBarProps {
  segments: CompositionSegment[];
}

/**
 * Composition sub-bar + legend — each segment's width is its share of the segment sum
 * (zero total ⇒ all segments render 0-width; see `compositionSegmentWidths`). Slots into
 * a `VitalTile`'s `children`, e.g. the Population tile's unskilled/technician/engineer/
 * unemployed split.
 */
export function CompositionBar({ segments }: CompositionBarProps) {
  const widths = compositionSegmentWidths(segments);
  const summary = widths.map((segment) => `${segment.label} ${Math.round(segment.pct)}%`).join(", ");
  return (
    <div>
      <div
        role="img"
        aria-label={`Composition: ${summary}`}
        title="composition"
        className="mt-[9px] flex h-[6px] overflow-hidden bg-surface-active"
      >
        {widths.map((segment) => (
          <span
            key={segment.label}
            className="block h-full border-r border-surface last:border-r-0"
            style={{ width: `${segment.pct}%`, background: segment.color }}
          />
        ))}
      </div>
      <div className="mt-[7px] flex flex-wrap gap-2 text-xs text-text-secondary">
        {widths.map((segment) => (
          <span key={segment.label} className="inline-flex items-center">
            <i aria-hidden className="mr-[3px] inline-block h-2 w-2" style={{ background: segment.color }} />
            {segment.label} {Math.round(segment.pct)}%
          </span>
        ))}
      </div>
    </div>
  );
}
