import type { ReactNode } from "react";
import {
  compositionSegmentWidths,
  type CompositionSegment,
} from "@/components/ui/vital-tile-helpers";

export type { CompositionSegment } from "@/components/ui/vital-tile-helpers";

/** The tile's 5px fill meter — omit on tiles that use `children` for their body instead (e.g. Population). */
export interface VitalMeter {
  pct: number;
  color: string;
}

export interface VitalTileProps {
  /** Uppercase display label (e.g. "Stability"). */
  label: string;
  /** Status-dot color — a CSS color value (hex or a `var(--color-*)` theme token). */
  dotColor: string;
  /** Pre-formatted large mono value (e.g. "82", "2.42"). */
  value: string;
  /** Small suffix after the value (e.g. "%", "M"). */
  unit?: string;
  meter?: VitalMeter;
  /** Trailing hint content (e.g. "unrest 0.18"). */
  hint?: ReactNode;
  /** Body content between the value and the hint row — e.g. a `CompositionBar`. */
  children?: ReactNode;
  /** Grid columns this tile spans in its parent `VitalGrid` (default 1). */
  colSpan?: number;
}

/**
 * One "vital" stat tile — loud label + big mono value, an optional 5px meter fill or a
 * `children` body slot, and an optional trailing hint row. The system Overview and the
 * faction Overview grids reuse it unmodified.
 */
export function VitalTile({ label, dotColor, value, unit, meter, hint, children, colSpan = 1 }: VitalTileProps) {
  const hasHintRow = hint !== undefined;
  return (
    <div
      className="relative min-h-[92px] border border-border border-l-2 border-l-accent bg-surface px-[11px] pt-[10px] pb-[11px]"
      style={{ gridColumn: `span ${colSpan}` }}
    >
      <div className="flex items-center gap-[5px] font-display text-[9.5px] font-semibold tracking-wider text-text-tertiary uppercase">
        <span
          aria-hidden
          className="inline-block h-[7px] w-[7px] shrink-0 rounded-full"
          style={{ background: dotColor }}
        />
        {label}
      </div>
      <div className="mt-[5px] font-mono text-[27px] leading-[1.05] font-medium text-text-primary">
        {value}
        {unit && <span className="text-[14px] text-text-secondary">{unit}</span>}
      </div>
      {meter && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(meter.pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${value}${unit ?? ""}`}
          className="mt-[9px] h-[5px] overflow-hidden bg-surface-active"
        >
          <span className="block h-full" style={{ width: `${meter.pct}%`, background: meter.color }} />
        </div>
      )}
      {children}
      {hasHintRow && (
        <div className="mt-[7px] flex items-center gap-[5px] text-[10.5px] text-text-secondary">
          {hint}
        </div>
      )}
    </div>
  );
}

export interface GhostVitalTileProps {
  /** Uppercase display label (e.g. "Future vitals"). */
  label: string;
  /** Placeholder body content — e.g. a list of future slot names. */
  future: ReactNode;
  /** Grid columns this tile spans in its parent `VitalGrid` (default 1). */
  colSpan?: number;
}

/**
 * Dashed "future vitals" placeholder tile — proves the grid is extensible: a caller drops
 * a real `VitalTile` into this slot once the stat is wired, with no grid redesign needed.
 */
export function GhostVitalTile({ label, future, colSpan = 1 }: GhostVitalTileProps) {
  return (
    <div
      className="flex min-h-[92px] flex-col justify-center border border-dashed border-border-strong border-l-2 border-l-border-strong bg-surface px-[11px] pt-[10px] pb-[11px] opacity-[.55]"
      style={{ gridColumn: `span ${colSpan}` }}
    >
      <div className="font-display text-[9.5px] font-semibold tracking-wider text-text-tertiary uppercase">
        {label}
      </div>
      <div className="mt-[6px] text-[10.5px] leading-[1.5] text-text-tertiary">{future}</div>
    </div>
  );
}

/** Column counts `VitalGrid` supports — 2-up today, 3-/4-up for denser future screens (e.g. faction Overview). */
export type VitalGridColumns = 2 | 3 | 4;

const GRID_COLUMNS_CLASS = {
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
} as const satisfies Record<VitalGridColumns, string>;

export interface VitalGridProps {
  children: ReactNode;
  /** Grid column count. Default 2 (Overview today); pass 3/4 for denser layouts with no redesign. */
  columns?: VitalGridColumns;
}

/**
 * N-up wrapper for `VitalTile`/`GhostVitalTile` children. Columns are strict equal `1fr`
 * (Tailwind's `grid-cols-N`); `items-stretch` sizes every tile in a row to the tallest, so a
 * child's `colSpan` (e.g. a 2-span Population tile) still lines up with its row siblings.
 */
export function VitalGrid({ children, columns = 2 }: VitalGridProps) {
  return (
    <div className={`mb-[14px] grid items-stretch gap-[9px] ${GRID_COLUMNS_CLASS[columns]}`}>{children}</div>
  );
}

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
      <div className="mt-[7px] flex flex-wrap gap-2 text-[9.5px] text-text-secondary">
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
