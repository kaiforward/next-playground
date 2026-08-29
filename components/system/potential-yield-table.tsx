import { PopoverTriggerLabel } from "@/components/ui/popover-trigger-label";
import { PopoverHeader } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { TermLabel } from "@/components/ui/term-label";
import { QUALITY_BAND_TEXT } from "@/lib/constants/ui";
import type { PotentialYieldRowView } from "@/lib/utils/substrate";

/**
 * One potential-yield row's popover body: per-body breakdown — name, slot count, ground value %,
 * and a locked marker where the body's tech isn't unlocked yet. Same dwell popover the industry
 * panel's deposit readouts use (`DepositPopoverBody`/`YieldPopoverBody`,
 * `components/system/industry-panel.tsx`).
 */
export function PotentialYieldPopoverBody({ row }: { row: PotentialYieldRowView }) {
  return (
    <div className="space-y-1">
      <PopoverHeader title={<span className="capitalize">{row.resource}</span>} />
      <div className="space-y-1 overflow-x-auto">
        {row.byBody.map((b, i) => (
          <div key={`${b.bodyId}-${i}`} className="flex items-center justify-between gap-2 whitespace-nowrap font-mono">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <TermLabel id="archetype">{b.archetypeName}</TermLabel>
              {/* Not a `TermLabel`: nesting the trigger's button styling (copper underline,
                  `text-accent`) inside this small pill overrides the badge's own slate tone and
                  adds an underline the pill isn't built for. Left unmarked. */}
              {b.locked && <Badge color="slate" variant="outline">Locked</Badge>}
            </span>
            <span className="text-text-tertiary">
              {b.slotCount} <TermLabel id="resourceSlot">{b.slotCount === 1 ? "slot" : "slots"}</TermLabel> ·{" "}
              <TermLabel id="qualityBand">{Math.round(b.groundValue * 100)}%</TermLabel>
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
              <PopoverTriggerLabel
                className="capitalize"
                content={<PotentialYieldPopoverBody row={row} />}
              >
                {row.resource}
              </PopoverTriggerLabel>
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
