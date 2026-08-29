"use client";

import { useState } from "react";
import type { PopNeedData, SystemProvisionRead } from "@/lib/types/api";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Badge, BADGE_COLOR_VAR } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { TrackMarker } from "@/components/ui/track-marker";
import { bandLabel, bandTone, provisionScaleSegments, provisionTrackTone } from "@/components/system/provision-view";
import type { SupplyRegime } from "@/lib/engine/population";
import { splitNeedsLedger } from "@/components/system/needs-view";
import { NeedCells, NeedsTable } from "@/components/system/needs-table";
import { NeedPopoverBody, NeedPopoverMeta } from "@/components/system/need-popover-body";

/** The trigger here is a focusable `<tr>`, not a word — nothing else names what the popover is
 *  about, so it carries the header title `NeedPopoverBody` used to render for itself. */
function NeedRow({ n }: { n: PopNeedData }) {
  return (
    <Popover dwell>
      <PopoverTrigger asChild>
        <tr tabIndex={0} className="border-b border-border/40 outline-none last:border-b-0 focus-visible:ring-1 focus-visible:ring-accent">
          <NeedCells n={n} density="panel" />
        </tr>
      </PopoverTrigger>
      <PopoverContent title={n.goodName} titleMeta={<NeedPopoverMeta need={n} />}>
        <NeedPopoverBody need={n} />
      </PopoverContent>
    </Popover>
  );
}

function NeedsLedger({ needs }: { needs: PopNeedData[] }) {
  const [expanded, setExpanded] = useState(false);
  const { problems, met } = splitNeedsLedger(needs);
  return (
    <NeedsTable density="panel">
      {problems.map((n) => <NeedRow key={n.goodId} n={n} />)}
      {met.length > 0 && !expanded && (
        <tr>
          <td colSpan={4} className="px-1.5 py-1.5 text-xs text-text-tertiary">
            <button type="button" onClick={() => setExpanded(true)} className="inline-flex items-center gap-1.5 hover:text-text-secondary">
              <span aria-hidden className="font-mono text-[10px] text-status-green-light">✓</span>
              {met.length} needs met <span className="font-mono text-[10px]">▸ expand</span>
            </button>
          </td>
        </tr>
      )}
      {expanded && met.map((n) => <NeedRow key={n.goodId} n={n} />)}
    </NeedsTable>
  );
}

/**
 * The Provisioned track — the four axis segments from `provisionScaleSegments` (deprived /
 * rationing / strained / supplied, derived from the same constants the classifier bins on), a solid
 * marker at today's level and a dashed marker at the remembered level. Deliberate restraint from the
 * design pass, whose earlier over-laboured version was rejected: no band-name labels on the track
 * (the chip above already names the current band) and no inline captions on the two markers (the "Now
 * X% / Used to Y%" key underneath carries both numbers).
 *
 * Under Famine the whole track takes the famine tone (`provisionTrackTone`) and its segment dividers
 * come off, so it reads as one unbroken emergency bar rather than four bands that happen to share a
 * colour. The markers stay where they are: a famine world's delivery really can sit high on the axis,
 * and the track saying so while the chip says Famine is exactly the contradiction the recolour
 * removes.
 */
function ProvisionTrack({ band, pct, expectationPct }: { band: SupplyRegime; pct: number; expectationPct: number }) {
  const segments = provisionScaleSegments();
  const famine = band === "famine";
  return (
    <div className="relative h-2.5">
      <div className="flex h-full overflow-hidden">
        {segments.map((s) => (
          <span
            key={s.band}
            aria-hidden
            className={`block h-full opacity-35 ${famine ? "" : "border-r border-surface last:border-r-0"}`}
            style={{ width: `${s.width}%`, background: BADGE_COLOR_VAR[provisionTrackTone(s.band, band)] }}
          />
        ))}
      </div>
      {/* Solid marker — today's level. */}
      <TrackMarker pct={pct} color="var(--color-text-primary)" />
      {/* Dashed marker — the remembered level. */}
      <TrackMarker pct={expectationPct} color="var(--color-text-secondary)" dashed />
    </div>
  );
}

/**
 * Provisioned — band chip, the percentage, the band track with today's/remembered markers and their
 * key, then the existing needs ledger directly beneath as its per-good decomposition. Composes the
 * exact per-good ledger `population-panel.tsx` used to own; unmoved logic, relocated presentation.
 * `"use client"` because the ledger's met-tail toggle is stateful.
 */
export function ProvisionBlock({ read, needs }: { read: SystemProvisionRead; needs: PopNeedData[] }) {
  return (
    <Card variant="bordered" padding="md">
      <div className="mb-3 flex items-center justify-between">
        <SectionHeader as="h4">Provisioned</SectionHeader>
        {read.assessed ? (
          <Badge color={bandTone(read.band)}>{bandLabel(read.band)}</Badge>
        ) : (
          <Badge color="slate">Not assessed</Badge>
        )}
      </div>

      {read.assessed ? (
        <>
          <div className="mb-2 font-mono text-2xl text-text-primary">{Math.round(read.pct)}%</div>
          <ProvisionTrack band={read.band} pct={read.pct} expectationPct={read.expectationPct} />
          <div className="mt-2.5 flex items-center gap-4 text-xs text-text-tertiary">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-0.5 bg-text-primary" />
              Now {Math.round(read.pct)}%
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-0.5 border-l-2 border-dashed border-text-secondary" />
              Used to {Math.round(read.expectationPct)}%
            </span>
          </div>
        </>
      ) : (
        <EmptyState message="Not yet assessed — this system hasn't completed an economy cycle." />
      )}

      <div className="mt-4 border-t border-border/60 pt-3">
        {needs.length === 0 ? (
          <EmptyState message="No needs." />
        ) : (
          <NeedsLedger needs={needs} />
        )}
      </div>
    </Card>
  );
}
