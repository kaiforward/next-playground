import { prepareResourceBars } from "@/lib/engine/resources";
import type { ResourceVector } from "@/lib/types/game";

interface ResourceVectorBarsProps {
  vector: ResourceVector;
  /** Sort rich-first (default false → canonical order). */
  sort?: boolean;
  /** Collapse near-zero resources into a muted trace line (default false). */
  collapseTrace?: boolean;
}

/**
 * Renders a ResourceVector as a labeled mini-bar strip. Bars normalize to the
 * vector's own max; the raw value is always shown so magnitude isn't lost.
 */
export function ResourceVectorBars({
  vector,
  sort = false,
  collapseTrace = false,
}: ResourceVectorBarsProps) {
  const { entries, trace } = prepareResourceBars(vector, { sort, collapseTrace });
  return (
    <div className="space-y-1">
      {entries.map((e) => (
        <div key={e.type} className="flex items-center gap-2">
          <span className="w-20 shrink-0 text-xs capitalize text-text-tertiary">
            {e.type}
          </span>
          <div className="h-1.5 flex-1 overflow-hidden bg-surface-active">
            <div className="h-full bg-accent" style={{ width: `${e.fraction * 100}%` }} />
          </div>
          <span className="w-12 shrink-0 text-right font-mono text-xs text-text-secondary">
            {e.value.toFixed(1)}
          </span>
        </div>
      ))}
      {trace.length > 0 && (
        <p className="text-xs capitalize text-text-tertiary">
          Trace: {trace.join(", ")}
        </p>
      )}
    </div>
  );
}
