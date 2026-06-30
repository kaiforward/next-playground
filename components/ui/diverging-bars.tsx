/**
 * Reusable diverging-bar list: each row grows a left stack from a centre
 * divider and a right stack from it, normalised to a shared `maxValue` so
 * multiple instances (e.g. per tier) share one scale. Segments carry a
 * direction colour (in = red, out = green) and a solid/hatch pattern.
 */

import { Fragment, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export interface BarSegment {
  value: number;
  side: "left" | "right";
  /** in = consumption/imports (red); out = production/exports (green). */
  color: "in" | "out";
  pattern: "solid" | "hatch";
}

export interface DivergingBarRow {
  key: string;
  label: string;
  net: number;
  netLabel: string;
  segments: BarSegment[];
  /** Render the label muted and skip the bar track (e.g. an un-traded good). */
  blank?: boolean;
  muted?: boolean;
  /** Rich hover tooltip content (e.g. partner sources/destinations), shown in a
   *  Radix tooltip. Requires an ancestor `TooltipProvider`. */
  tooltip?: ReactNode;
  /** Optional class override for this row's tooltip content box — e.g. a wider width
   *  when the rows carry long labels + large values that would otherwise wrap. */
  tooltipClassName?: string;
}

/**
 * Segment fill by direction and the hatch overlay, exported so legends key off the SAME source
 * of truth as the bars they document — no drifting duplicate colour literals. The hatch is
 * deliberately dense/dark enough to read as distinct from a solid same-colour segment at the
 * 10px bar height (the only differentiator between e.g. civilian vs manufacturing-input draw).
 */
export const BAR_FILL: Record<"in" | "out", string> = {
  in: "rgba(239,68,68,0.8)",
  out: "rgba(34,197,94,0.8)",
};
export const BAR_HATCH = "repeating-linear-gradient(135deg, rgba(0,0,0,0.55) 0 2px, transparent 2px 4px)";

function netClass(net: number): string {
  if (net > 0) return "text-status-green-light";
  if (net < 0) return "text-status-red-light";
  return "text-text-tertiary";
}

function Segments({ segments, max }: { segments: BarSegment[]; max: number }) {
  return (
    <>
      {segments.map((s, i) => (
        <div
          key={i}
          className="h-full"
          style={{
            width: max > 0 ? `${(s.value / max) * 100}%` : "0%",
            backgroundColor: BAR_FILL[s.color],
            backgroundImage: s.pattern === "hatch" ? BAR_HATCH : undefined,
          }}
        />
      ))}
    </>
  );
}

export function DivergingBars({ rows, maxValue }: { rows: DivergingBarRow[]; maxValue: number }) {
  return (
    <div className="space-y-1.5">
      {rows.map((row) => {
        const left = row.segments.filter((s) => s.side === "left");
        const right = row.segments.filter((s) => s.side === "right");
        // A row carrying tooltip detail is keyboard-focusable so the Radix tooltip
        // opens on focus (not just pointer hover); bare rows stay out of tab order.
        const interactive = row.tooltip != null;
        const barRow = (
          <div className="flex items-center gap-2" tabIndex={interactive ? 0 : undefined}>
            <span className={`w-24 shrink-0 truncate text-xs ${row.muted ? "text-text-tertiary" : "text-text-secondary"}`}>
              {row.label}
            </span>
            {row.blank ? (
              <div className="flex-1" />
            ) : (
              <div className="flex flex-1 items-center">
                {/* left stack fills toward the divider */}
                <div className="flex h-2.5 flex-1 justify-end overflow-hidden bg-surface-active">
                  <Segments segments={left} max={maxValue} />
                </div>
                <div className="h-3.5 w-px shrink-0 bg-border-strong" />
                {/* right stack fills away from the divider */}
                <div className="flex h-2.5 flex-1 overflow-hidden bg-surface-active">
                  <Segments segments={right} max={maxValue} />
                </div>
              </div>
            )}
            <span className={`w-12 shrink-0 text-right font-mono text-xs ${row.blank ? "text-text-tertiary opacity-50" : netClass(row.net)}`}>
              {row.blank ? "·" : row.netLabel}
            </span>
          </div>
        );

        // A row with tooltip content wraps its bar in a Radix tooltip (asChild keeps
        // the bar the direct grid child); otherwise it renders bare.
        if (!interactive) {
          return <Fragment key={row.key}>{barRow}</Fragment>;
        }
        return (
          <Tooltip key={row.key}>
            <TooltipTrigger asChild>{barRow}</TooltipTrigger>
            <TooltipContent className={row.tooltipClassName}>{row.tooltip}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
