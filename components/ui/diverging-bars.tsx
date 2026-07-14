/**
 * Diverging bar track: a left stack grows from a centre divider and a right stack
 * grows away from it, both normalised to a shared `maxValue` so multiple instances
 * (e.g. per tier) share one scale. Segments carry a direction colour (in = red,
 * out = green) and a solid/hatch pattern.
 */

export interface BarSegment {
  value: number;
  side: "left" | "right";
  /** in = consumption/imports (red); out = production/exports (green). */
  color: "in" | "out";
  pattern: "solid" | "hatch";
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

/**
 * The bare diverging bar track for one row: a left stack growing toward the centre
 * divider and a right stack growing away from it, both normalised to `maxValue`.
 * Fills its container's width, so it drops into a flex row (wrap in a flex-1 parent)
 * or a table cell equally.
 */
export function DivergingBarTrack({ segments, maxValue }: { segments: BarSegment[]; maxValue: number }) {
  const left = segments.filter((s) => s.side === "left");
  const right = segments.filter((s) => s.side === "right");
  return (
    <div className="flex w-full items-center">
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
  );
}
