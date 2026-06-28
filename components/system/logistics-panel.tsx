"use client";

import { useMemo } from "react";
import { useSystemLogistics } from "@/lib/hooks/use-system-logistics";
import { DivergingBars, type DivergingBarRow } from "@/components/ui/diverging-bars";
import { VolumeSparkline } from "@/components/system/volume-sparkline";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TIER_COLOR, TIER_LABEL, pixiHexToCss } from "@/lib/constants/good-colors";
import type { GoodTier } from "@/lib/types/game";
import type { LogisticsGoodRow, TradeFlowPartner } from "@/lib/types/api";

const TIERS: GoodTier[] = [0, 1, 2];

function fmtNet(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : ""}${r}`;
}

/** Top source/destination partner systems for an External bar's hover tooltip. */
function PartnerList({ label, partners }: { label: string; partners: TradeFlowPartner[] }) {
  if (partners.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="font-display text-[10px] uppercase tracking-wider text-text-tertiary">{label}</p>
      <dl className="space-y-0.5 text-xs">
        {partners.map((p) => (
          <div key={p.systemId} className="flex justify-between gap-3">
            <dt className="truncate text-text-secondary">{p.systemName}</dt>
            <dd className="shrink-0 font-mono text-text-primary">{Math.round(p.quantity)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function internalRow(g: LogisticsGoodRow): DivergingBarRow {
  return {
    key: g.goodId,
    label: g.goodName,
    net: g.internalNet,
    netLabel: fmtNet(g.internalNet),
    tooltip: (
      <dl className="space-y-0.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-text-tertiary">Produces</dt>
          <dd className="font-mono text-status-green-light">{g.production.toFixed(1)}/cyc</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-text-tertiary">Consumes</dt>
          <dd className="font-mono text-status-red-light">{g.consumption.toFixed(1)}/cyc</dd>
        </div>
      </dl>
    ),
    segments: [
      { value: g.consumption, side: "left", color: "in", pattern: "solid" },
      { value: g.production, side: "right", color: "out", pattern: "solid" },
    ],
  };
}

function externalRow(g: LogisticsGoodRow): DivergingBarRow {
  if (!g.traded) {
    return { key: g.goodId, label: g.goodName, net: 0, netLabel: "·", blank: true, muted: true, segments: [] };
  }
  const hasPartners = g.importPartners.length > 0 || g.exportPartners.length > 0;
  return {
    key: g.goodId,
    label: g.goodName,
    net: g.externalNet,
    netLabel: fmtNet(g.externalNet),
    tooltip: hasPartners ? (
      <div className="space-y-1.5">
        <PartnerList label="Sources" partners={g.importPartners} />
        <PartnerList label="Destinations" partners={g.exportPartners} />
      </div>
    ) : undefined,
    segments: [
      // imports (left): hatch market then solid logistics → solid sits at the divider
      { value: g.importMarket, side: "left", color: "in", pattern: "hatch" },
      { value: g.importLogistics, side: "left", color: "in", pattern: "solid" },
      // exports (right): solid logistics then hatch market → solid sits at the divider
      { value: g.exportLogistics, side: "right", color: "out", pattern: "solid" },
      { value: g.exportMarket, side: "right", color: "out", pattern: "hatch" },
    ],
  };
}

export function LogisticsPanel({ systemId }: { systemId: string }) {
  const data = useSystemLogistics(systemId);

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

  // Build each tier's internal/external bar rows once per data change — the
  // transforms allocate fresh tooltip JSX, so keep them out of the render body.
  const tierRows = useMemo(() => {
    if (!byTier) return null;
    const out = new Map<GoodTier, { internal: DivergingBarRow[]; external: DivergingBarRow[] }>();
    for (const [tier, rows] of byTier) {
      out.set(tier, { internal: rows.map(internalRow), external: rows.map(externalRow) });
    }
    return out;
  }, [byTier]);

  if (data.visibility === "unknown") {
    return <EmptyState message="Scan this system with a ship in range to survey its logistics." />;
  }
  if (data.rows.length === 0) {
    return <EmptyState message="No logistics activity — this system neither produces, consumes, nor trades." />;
  }

  return (
    <div className="space-y-4">
      <Card variant="bordered" padding="md">
        {/* column headers + legends */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-baseline justify-between">
              <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-text-primary">Internal · production vs consumption</h4>
              <span className="font-mono text-[10px] text-text-tertiary">{data.activeGoodCount} goods</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-text-tertiary">
              <span className="w-24 shrink-0" />
              <div className="flex flex-1 justify-between"><span>&#9664; Consumes</span><span>Produces &#9654;</span></div>
              <span className="w-12 shrink-0 text-right">Net/cyc</span>
            </div>
          </div>
          <div>
            <div className="flex items-baseline justify-between">
              <h4 className="font-display text-xs font-semibold uppercase tracking-wider text-text-primary">External · imports vs exports</h4>
              <span className="font-mono text-[10px] text-text-tertiary">trades {data.tradedGoodCount}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[10px] text-text-tertiary">
              <span className="w-24 shrink-0" />
              <div className="flex flex-1 justify-between"><span>&#9664; Imports</span><span>Exports &#9654;</span></div>
              <span className="w-12 shrink-0 text-right">Net</span>
            </div>
          </div>
        </div>

        {/* flow-split legend */}
        <div className="mt-2 flex items-center gap-4 border-t border-border pt-2 text-[10px] text-text-tertiary">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5" style={{ backgroundColor: "rgba(34,197,94,0.8)" }} /> directed logistics
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-5" style={{ backgroundColor: "rgba(34,197,94,0.8)", backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.5) 0 2px, transparent 2px 5px)" }} /> market diffusion
          </span>
        </div>

        {/* tier groups */}
        {TIERS.map((tier) => {
          const group = tierRows?.get(tier);
          if (!group || group.internal.length === 0) return null;
          return (
            <div key={tier} className="mt-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="h-2 w-2 shrink-0" style={{ backgroundColor: pixiHexToCss(TIER_COLOR[tier]) }} />
                <span className="font-mono text-[10px] uppercase tracking-widest text-text-secondary">{TIER_LABEL[tier]}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <DivergingBars rows={group.internal} maxValue={data.internalMax} />
                <DivergingBars rows={group.external} maxValue={data.externalMax} />
              </div>
            </div>
          );
        })}
      </Card>

      <Card variant="bordered" padding="md">
        <h4 className="mb-1 font-display text-xs font-semibold uppercase tracking-wider text-text-primary">Trade volume over time</h4>
        <VolumeSparkline buckets={data.volumeHistory} />
      </Card>
    </div>
  );
}
