"use client";

import { useState } from "react";
import type { PopNeedData, SystemProvisionRead } from "@/lib/types/api";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Badge, BADGE_COLOR_VAR } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { bandLabel, bandTone, provisionScaleSegments } from "@/components/system/provision-view";
import { needSeverity, splitNeedsLedger, SEVERITY_GLYPH, SEVERITY_TEXT } from "@/components/system/needs-view";
import { NeedCells, NeedsTable } from "@/components/system/needs-table";

// Tier swatch colours match the dataviz-validated categorical set (base copper /
// technician deep-cyan / engineer purple) used elsewhere for consumer tiers.
const TIER_META = [
  { key: "base", label: "Base population", color: "#d06a42" },
  { key: "technicians", label: "Technicians", color: "#0891b2" },
  { key: "engineers", label: "Engineers", color: "#a855f7" },
] as const;

function NeedTooltip({ n }: { n: PopNeedData }) {
  const sev = needSeverity(n.satisfaction);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
        <span className="font-display text-text-primary">{n.goodName}</span>
        <span className={`font-mono ${SEVERITY_TEXT[sev]}`}>{SEVERITY_GLYPH[sev]} {Math.round(n.satisfaction * 100)}% met</span>
      </div>
      <p className="font-mono text-text-secondary">
        want {n.want.toFixed(2)}/cyc · delivered {n.delivered.toFixed(2)}/cyc · pressure {n.pressure.toFixed(2)}
      </p>
      <div className="space-y-0.5 border-t border-border/60 pt-1">
        {TIER_META.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span aria-hidden className="inline-block h-2 w-2" style={{ backgroundColor: t.color }} /> {t.label}
            </span>
            <span className="font-mono text-text-primary">{n.breakdown[t.key].toFixed(2)}/cyc</span>
          </div>
        ))}
      </div>
      <p className="border-t border-border/60 pt-1 text-text-secondary">Doing worse than this population is used to breeds unrest — famine and critical shortages always do.</p>
    </div>
  );
}

function NeedRow({ n }: { n: PopNeedData }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <tr tabIndex={0} className="border-b border-border/40 outline-none last:border-b-0 focus-visible:ring-1 focus-visible:ring-accent">
          <NeedCells n={n} density="panel" />
        </tr>
      </TooltipTrigger>
      <TooltipContent className="w-64"><NeedTooltip n={n} /></TooltipContent>
    </Tooltip>
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
 * The Provisioned track — the three axis segments from `provisionScaleSegments` (rationing /
 * strained / supplied, derived from the same constants the classifier bins on), a solid rule at
 * today's level and a dashed rule at the remembered level. Deliberate restraint from the design
 * pass, whose earlier over-laboured version was rejected: no band-name labels on the track (the
 * chip above already names the current band) and no inline captions on the two rules (the "Now
 * X% / Used to Y%" key underneath carries both numbers).
 */
function ProvisionTrack({ pct, expectationPct }: { pct: number; expectationPct: number }) {
  const segments = provisionScaleSegments();
  return (
    <div className="relative h-2.5">
      <div className="flex h-full overflow-hidden">
        {segments.map((s) => (
          <span
            key={s.band}
            aria-hidden
            className="block h-full border-r border-surface opacity-35 last:border-r-0"
            style={{ width: `${s.width}%`, background: BADGE_COLOR_VAR[bandTone(s.band)] }}
          />
        ))}
      </div>
      {/* Solid rule — today's level. */}
      <span
        aria-hidden
        className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text-primary"
        style={{ left: `${pct}%` }}
      />
      {/* Dashed rule — the remembered level. Zero-width span; only its left border paints. */}
      <span
        aria-hidden
        className="absolute -top-0.5 -bottom-0.5 border-l-2 border-dashed border-text-secondary"
        style={{ left: `${expectationPct}%` }}
      />
    </div>
  );
}

/**
 * Provisioned — band chip, the percentage, the band track with today's/remembered rules and their
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
          <ProvisionTrack pct={read.pct} expectationPct={read.expectationPct} />
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
