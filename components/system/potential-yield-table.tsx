import { Tooltip, TooltipTriggerLabel, TooltipContent } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { QUALITY_BAND_TEXT } from "@/lib/constants/ui";
import type { PotentialYieldRowView } from "@/lib/utils/substrate";

/**
 * One potential-yield row's tooltip: per-body breakdown — name, slot count, ground value %, and a
 * locked marker where the body's tech isn't unlocked yet. Same tooltip primitive the industry
 * panel's deposit tooltips use (`DepositTooltipBody`/`YieldTooltipBody`,
 * `components/system/industry-panel.tsx`).
 */
export function PotentialYieldTooltipBody({ row }: { row: PotentialYieldRowView }) {
  return (
    <div className="space-y-1">
      <p className="font-display text-sm font-semibold capitalize text-text-primary">{row.resource}</p>
      <div className="space-y-1 border-t border-border/60 pt-1">
        {row.byBody.map((b, i) => (
          <div key={`${b.bodyId}-${i}`} className="flex items-center justify-between gap-2 font-mono text-xs">
            <span className="flex items-center gap-1.5 text-text-secondary">
              {b.archetypeName}
              {b.locked && <Badge color="slate" variant="outline">Locked</Badge>}
            </span>
            <span className="whitespace-nowrap text-text-tertiary">
              {b.slotCount} {b.slotCount === 1 ? "slot" : "slots"} · {Math.round(b.groundValue * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Astrography's "what could this system be worth" table — one row per resource with at least one
 * deposit slot anywhere in the system, locked bodies included. The figure is a POTENTIAL: the mean
 * ground value over every slot of that resource in the system, never what extractors currently
 * realise (that stays the industry panel's worked-prefix yield). A resource with no slots anywhere
 * renders no row. Renders nothing at all when the system has no deposits of any kind.
 */
export function PotentialYieldTable({ rows }: { rows: PotentialYieldRowView[] }) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th className="border-b border-border-strong px-1.5 py-1 text-left font-display text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Resource
          </th>
          <th className="border-b border-border-strong px-1.5 py-1 text-right font-display text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Potential yield
          </th>
          <th className="border-b border-border-strong px-1.5 py-1 text-right font-display text-xs font-semibold uppercase tracking-wider text-text-tertiary">
            Slots
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.resource} className="border-b border-border/40 last:border-b-0">
            <td className="px-1.5 py-1 text-text-primary">
              <Tooltip>
                <TooltipTriggerLabel className="capitalize">{row.resource}</TooltipTriggerLabel>
                <TooltipContent className="w-64 text-xs"><PotentialYieldTooltipBody row={row} /></TooltipContent>
              </Tooltip>
            </td>
            <td className={`px-1.5 py-1 text-right font-mono ${QUALITY_BAND_TEXT[row.band]}`}>
              {Math.round(row.yieldMult * 100)}%
            </td>
            <td className="px-1.5 py-1 text-right font-mono text-text-tertiary">{row.slotCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
