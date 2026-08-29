"use client";

import { Fragment, useMemo } from "react";
import { useSystemLogistics } from "@/lib/hooks/use-system-logistics";
import {
  DivergingBarTrack,
  BAR_FILL,
  BAR_HATCH,
  type BarSegment,
} from "@/components/ui/diverging-bars";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VolumeSparkline } from "@/components/system/volume-sparkline";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TIER_COLOR, TIER_LABEL, pixiHexToCss } from "@/lib/constants/good-colors";
import type { GoodTier } from "@/lib/types/game";
import type { LogisticsGoodRow, TradeFlowPartner } from "@/lib/types/api";

const TIERS: GoodTier[] = [0, 1, 2];

function fmtNet(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const k = abs / 1000;
    // one decimal below 10k ("1.2k"), whole above ("12k")
    return `${sign}${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
  }
  return `${sign}${Math.round(abs * 10) / 10}`;
}

function netClass(net: number): string {
  if (net > 0) return "text-status-green-light";
  if (net < 0) return "text-status-red-light";
  return "text-text-tertiary";
}

/** A legend colour chip keyed off the SAME fill/hatch tokens the bars use (diverging-bars.tsx),
 *  so the legend can't drift from the colours it documents. */
function LegendSwatch({ color, hatch = false }: { color: "in" | "out"; hatch?: boolean }) {
  return (
    <span
      className="inline-block h-2.5 w-5"
      style={{ backgroundColor: BAR_FILL[color], backgroundImage: hatch ? BAR_HATCH : undefined }}
    />
  );
}

/** Top source/destination partner systems for an External bar's popover. */
function PartnerList({ label, partners }: { label: string; partners: TradeFlowPartner[] }) {
  if (partners.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="font-display text-xs uppercase tracking-wider text-text-tertiary">{label}</p>
      <dl className="space-y-0.5">
        {partners.map((p) => (
          <div key={p.systemId} className="flex justify-between gap-3">
            <dt className="truncate text-text-secondary">{p.systemName}</dt>
            <dd className="shrink-0 font-mono text-text-primary">{p.quantity.toFixed(1)}/cyc</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Internal (production vs consumption) bar segments: consumes on the left (hatched
 *  manufacturing input then solid civilian, so solid sits at the divider), produces on the right. */
function internalSegments(g: LogisticsGoodRow): BarSegment[] {
  return [
    { value: g.inputDemand, side: "left", color: "in", pattern: "hatch" },
    { value: g.consumption, side: "left", color: "in", pattern: "solid" },
    { value: g.production, side: "right", color: "out", pattern: "solid" },
  ];
}

/** External (imports vs exports) bar segments: imports left, exports right. */
function externalSegments(g: LogisticsGoodRow): BarSegment[] {
  return [
    { value: g.importLogistics, side: "left", color: "in", pattern: "solid" },
    { value: g.exportLogistics, side: "right", color: "out", pattern: "solid" },
  ];
}

/** Internal bar popover body: the produces/consumes totals and the civilian/manufacturing consumption split. */
function internalPopoverBody(g: LogisticsGoodRow): React.ReactNode {
  const totalConsumption = g.consumption + g.inputDemand;
  return (
    <dl className="space-y-0.5 whitespace-nowrap">
      <div className="flex justify-between gap-3">
        <dt className="text-text-tertiary">Produces</dt>
        <dd className="font-mono text-status-green-light">{g.production.toFixed(1)}/cyc</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-text-tertiary">Consumes</dt>
        <dd className="font-mono text-status-red-light">{totalConsumption.toFixed(1)}/cyc</dd>
      </div>
      {g.inputDemand > 0 && (
        <>
          <div className="flex justify-between gap-3 pl-2">
            <dt className="text-text-tertiary">&middot; civilian</dt>
            <dd className="font-mono text-text-secondary">{g.consumption.toFixed(1)}/cyc</dd>
          </div>
          <div className="flex justify-between gap-3 pl-2">
            <dt className="text-text-tertiary">&middot; manufacturing</dt>
            <dd className="font-mono text-text-secondary">{g.inputDemand.toFixed(1)}/cyc</dd>
          </div>
        </>
      )}
    </dl>
  );
}

/** External bar popover body: top source/destination partner systems — undefined when none are tracked. */
function externalPopoverBody(g: LogisticsGoodRow): React.ReactNode | undefined {
  if (g.importPartners.length === 0 && g.exportPartners.length === 0) return undefined;
  return (
    <div className="space-y-1.5">
      <PartnerList label="Sources" partners={g.importPartners} />
      <PartnerList label="Destinations" partners={g.exportPartners} />
    </div>
  );
}

/** A diverging bar in a table cell, wrapped in a keyboard-focusable dwell popover when it
 *  carries detail (so the popover opens on focus, not just hover); otherwise rendered bare.
 *  The trigger is a focusable wrapper round the bar track, not a word — `title` names the good
 *  and which bar (Internal/External) the reader is looking at, since nothing else does. */
function BarCell({
  segments,
  maxValue,
  popoverContent,
  title,
}: {
  segments: BarSegment[];
  maxValue: number;
  popoverContent?: React.ReactNode;
  title?: React.ReactNode;
}) {
  const track = <DivergingBarTrack segments={segments} maxValue={maxValue} />;
  if (!popoverContent) return track;
  return (
    <Popover dwell>
      <PopoverTrigger asChild>
        <div
          tabIndex={0}
          className="w-full cursor-default outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {track}
        </div>
      </PopoverTrigger>
      <PopoverContent title={title}>{popoverContent}</PopoverContent>
    </Popover>
  );
}

/** One good = one table row: name, internal bar + net, external bar + net. */
function GoodRow({
  g,
  internalMax,
  externalMax,
}: {
  g: LogisticsGoodRow;
  internalMax: number;
  externalMax: number;
}) {
  return (
    <tr className="hover:bg-surface-hover">
      <td title={g.goodName} className="truncate px-1.5 py-1 align-middle text-xs text-text-secondary">
        {g.goodName}
      </td>
      <td className="px-1.5 py-1 align-middle">
        <BarCell
          segments={internalSegments(g)}
          maxValue={internalMax}
          popoverContent={internalPopoverBody(g)}
          title={`${g.goodName} — Internal`}
        />
      </td>
      <td className={`px-1 py-1 text-right align-middle font-mono text-xs ${netClass(g.internalNet)}`}>
        {fmtNet(g.internalNet)}
      </td>
      <td className="border-l border-border px-1.5 py-1 align-middle">
        {g.traded ? (
          <BarCell
            segments={externalSegments(g)}
            maxValue={externalMax}
            popoverContent={externalPopoverBody(g)}
            title={`${g.goodName} — External`}
          />
        ) : (
          <div className="h-2.5" />
        )}
      </td>
      <td
        className={`px-1 py-1 text-right align-middle font-mono text-xs ${
          g.traded ? netClass(g.externalNet) : "text-text-tertiary opacity-50"
        }`}
      >
        {g.traded ? fmtNet(g.externalNet) : "·"}
      </td>
    </tr>
  );
}

export function LogisticsPanel({ systemId }: { systemId: string }) {
  const data = useSystemLogistics(systemId);

  // Group the tier-ascending rows into per-tier buckets for the spanning divider rows.
  const byTier = useMemo(() => {
    if (data.visibility !== "visible") return null;
    const map = new Map<GoodTier, LogisticsGoodRow[]>();
    for (const g of data.rows) {
      const arr = map.get(g.tier) ?? [];
      arr.push(g);
      map.set(g.tier, arr);
    }
    return map;
  }, [data]);

  if (data.visibility === "unknown") {
    return <EmptyState message="This system isn't developed yet — no trade activity to show." />;
  }
  if (data.rows.length === 0) {
    return <EmptyState message="No logistics activity — this system neither produces, consumes, nor trades." />;
  }

  const { internalMax, externalMax } = data;

  return (
    <div className="space-y-4">
      <Card variant="bordered" padding="xs">
        {/* legend — internal consumption split (civilian vs manufacturing) shares the external directions */}
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <LegendSwatch color="in" /> consumes / imports
          </span>
          <span className="inline-flex items-center gap-1.5">
            <LegendSwatch color="in" hatch /> mfg input
          </span>
          <span className="inline-flex items-center gap-1.5">
            <LegendSwatch color="out" /> produces / exports
          </span>
        </div>

        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col className="w-[84px]" />
            <col />
            <col className="w-[50px]" />
            <col />
            <col className="w-[50px]" />
          </colgroup>
          <thead>
            <tr>
              <th aria-hidden />
              <th
                colSpan={2}
                className="border-b border-border pb-1 text-center font-display text-xs font-semibold uppercase tracking-wider text-text-secondary"
              >
                Internal
              </th>
              <th
                colSpan={2}
                className="border-b border-l border-border pb-1 text-center font-display text-xs font-semibold uppercase tracking-wider text-text-secondary"
              >
                External
              </th>
            </tr>
            <tr>
              <th className="border-b border-border-strong px-1.5 py-1 text-left font-display text-xs font-normal uppercase tracking-wider text-text-tertiary">
                Good
              </th>
              <th className="border-b border-border-strong px-1.5 py-1 text-center font-mono text-xs text-text-tertiary">
                &#9664; Cons &middot; Prod &#9654;
              </th>
              <th className="border-b border-border-strong px-1 py-1 text-right font-display text-xs font-normal uppercase tracking-wider text-text-tertiary">
                Net
              </th>
              <th className="border-b border-l border-border-strong px-1.5 py-1 text-center font-mono text-xs text-text-tertiary">
                &#9664; Imp &middot; Exp &#9654;
              </th>
              <th className="border-b border-border-strong px-1 py-1 text-right font-display text-xs font-normal uppercase tracking-wider text-text-tertiary">
                Net
              </th>
            </tr>
          </thead>
          <tbody>
            {TIERS.map((tier) => {
              const rows = byTier?.get(tier);
              if (!rows || rows.length === 0) return null;
              return (
                <Fragment key={tier}>
                  <tr>
                    <td colSpan={5} className="px-1.5 pb-1 pt-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0"
                          style={{ backgroundColor: pixiHexToCss(TIER_COLOR[tier]) }}
                        />
                        <span className="font-mono text-xs uppercase tracking-widest text-text-secondary">
                          {TIER_LABEL[tier]}
                        </span>
                        <span className="h-px flex-1 bg-border" />
                      </div>
                    </td>
                  </tr>
                  {rows.map((g) => (
                    <GoodRow key={g.goodId} g={g} internalMax={internalMax} externalMax={externalMax} />
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card variant="bordered" padding="xs">
        <h4 className="mb-1 font-display text-xs font-semibold uppercase tracking-wider text-text-primary">
          Trade volume over time
        </h4>
        <VolumeSparkline buckets={data.volumeHistory} />
      </Card>
    </div>
  );
}
