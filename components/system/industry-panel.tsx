"use client";

import type { CSSProperties } from "react";
import { useSystemIndustry } from "@/lib/hooks/use-system-industry";
import { GOODS } from "@/lib/constants/goods";
import { BUILDING_TYPES, HOUSING_TYPE } from "@/lib/constants/industry";
import { INFRASTRUCTURE_DECAY_PARAMS } from "@/lib/constants/infrastructure";
import { QUALITY_BAND_TEXT } from "@/lib/constants/ui";
import { buildingHealth, industryHealth } from "@/lib/engine/industry";
import type { IndustryHealth, IdleReason, SystemIndustryReadout } from "@/lib/engine/industry";
import type { QualityBandId } from "@/lib/types/game";
import { formatMagnitude } from "@/lib/utils/format";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Badge, type BadgeColor } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoIcon } from "@/components/ui/icons";
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { SubstrateTradeBars } from "@/components/system/substrate-trade-bars";
import { EconomyCycleCaption } from "@/components/system/economy-cycle-caption";

const THRESHOLD = INFRASTRUCTURE_DECAY_PARAMS.unrestThreshold;

/** Health → the labels/colours one place so the badge, dots, bars and tally agree. */
const HEALTH: Record<IndustryHealth, { sys: string; row: string; badge: BadgeColor; dot: string; fill: string; text: string }> = {
  thriving:  { sys: "Thriving",  row: "stable",     badge: "green", dot: "bg-status-green", fill: "bg-status-green", text: "text-status-green-light" },
  coasting:  { sys: "Coasting",  row: "idle",       badge: "amber", dot: "bg-status-amber", fill: "bg-status-amber", text: "text-status-amber-light" },
  declining: { sys: "Declining", row: "collapsing", badge: "red",   dot: "bg-status-red",   fill: "bg-status-red",   text: "text-status-red-light" },
};

const IDLE_CAUSE: Record<IdleReason, string> = {
  occupancy: "low occupancy",
  labour: "labour short",
  selling: "output not selling",
};

// Faded-copper hatch = "housing can still grow here"; faint light hatch = idle capacity.
const COPPER_HATCH = "repeating-linear-gradient(135deg, rgba(208,106,66,0.45) 0 2px, transparent 2px 6px)";
const IDLE_HATCH = "repeating-linear-gradient(135deg, transparent 0 4px, rgba(201,209,217,0.06) 4px 8px)";

type BuildingEntry = SystemIndustryReadout["buildings"][number];

/** Human-readable label for a building type or good id. */
function label(id: string): string {
  return id === HOUSING_TYPE ? "Housing" : (GOODS[id]?.name ?? id);
}

/** The honest verb for "in use" per pillar — drives the row's hover tooltip. */
function usedNoun(tier: number): string {
  if (tier === -1) return "occupied";
  if (tier === 0) return "worked";
  return "staffed";
}

function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

/** A stacked land bar — structural slices (who holds the ground) + free tail. */
function LandBar({ segments }: { segments: Array<{ key: string; width: number; className?: string; style?: CSSProperties }> }) {
  return (
    <div className="flex h-3.5 overflow-hidden border border-border bg-surface-active">
      {segments.map((s) => (
        <div key={s.key} className={s.className} style={{ width: `${s.width}%`, ...s.style }} />
      ))}
    </div>
  );
}

/** One building: status dot · name (+ yield) · used/built bar · % · magnitude, with cause/needs lines. */
function BuildingRow({
  b,
  unrest,
  yieldMult,
  yieldBand,
  supply,
}: {
  b: BuildingEntry;
  unrest: number;
  yieldMult?: number;
  yieldBand?: QualityBandId;
  supply?: SystemIndustryReadout["supplyChain"][number];
}) {
  const health = buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD });
  const meta = HEALTH[health];
  const ratioPct = b.count > 0 ? (b.used / b.count) * 100 : 0;

  // Cause line — only for rows that aren't stable. Priority: over-capacity, then unrest, then the idle constraint.
  let cause: string | undefined;
  if (health !== "thriving") {
    if (b.used > b.count) cause = "over capacity";
    else if (unrest >= THRESHOLD) cause = "high unrest";
    else if (b.idleReason) cause = IDLE_CAUSE[b.idleReason];
  }

  const throttled = supply !== undefined && supply.inputGate < 0.999;

  return (
    <div className="border-b border-border/40 px-3 py-1.5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 ${meta.dot}`} />
        <span className="flex min-w-[104px] items-center gap-1.5 text-sm text-text-primary">
          {label(b.buildingType)}
          {yieldMult !== undefined && (
            <span className={`font-mono text-[10px] ${yieldBand ? QUALITY_BAND_TEXT[yieldBand] : "text-text-tertiary"}`}>
              ×{yieldMult.toFixed(2)}
            </span>
          )}
        </span>
        <div
          className="relative h-3.5 flex-1 overflow-hidden border border-border bg-surface-active"
          style={{ backgroundImage: IDLE_HATCH }}
          title={`${formatMagnitude(b.used)} of ${formatMagnitude(b.count)} ${usedNoun(b.tier)}`}
        >
          <div className={`absolute inset-y-0 left-0 ${meta.fill}`} style={{ width: `${Math.min(100, ratioPct)}%` }} />
        </div>
        <span className={`w-9 text-right font-mono text-xs ${meta.text}`}>{Math.round(ratioPct)}%</span>
        <span className="w-[52px] text-right font-mono text-[11px] text-text-secondary">
          <span className="text-text-primary">{formatMagnitude(b.used)}</span>/{formatMagnitude(b.count)}
        </span>
      </div>

      {cause && (
        <p className="mt-1 ml-[26px] text-[11px] text-text-tertiary">
          <span className="font-mono uppercase tracking-wide text-text-tertiary/80">cause</span> {cause}
        </p>
      )}
      {supply && (
        <p className="mt-1 ml-[26px] flex items-center gap-1.5 text-[11px]">
          <span className="font-mono uppercase tracking-wide text-text-tertiary/80">needs</span>
          {throttled ? (
            <span className="font-mono text-status-red-light">
              &#9888; {supply.throttledBy.map(label).join(", ")} {Math.round(supply.inputGate * 100)}%
            </span>
          ) : (
            <span className="font-mono text-status-green-light">&#10003; inputs</span>
          )}
        </p>
      )}
    </div>
  );
}

/** Pool header: title · sub · used / total · free. */
function PoolHeader({ title, sub, used, total }: { title: string; sub: string; used: number; total: number }) {
  return (
    <div className="mb-1.5 flex items-baseline gap-2">
      <span className="font-display text-[11px] font-semibold uppercase tracking-wider text-text-primary">{title}</span>
      <span className="font-mono text-[10px] text-text-tertiary">{sub}</span>
      <span className="ml-auto font-mono text-[11px] text-text-secondary">
        <span className="text-text-primary">{formatMagnitude(used)}</span> / {formatMagnitude(total)} used ·{" "}
        <span className="text-accent">{formatMagnitude(Math.max(0, total - used))} free</span>
      </span>
    </div>
  );
}

function RoleLabel({ children }: { children: string }) {
  return <p className="px-3 pb-0.5 pt-2 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">{children}</p>;
}

function LegendTooltip() {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="Legend" className="text-text-tertiary transition-colors hover:text-text-secondary">
            <InfoIcon className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="w-60 space-y-2">
          <div>
            <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Health — bar colour</p>
            <ul className="space-y-0.5 text-[11px] text-text-secondary">
              <li><span className="mr-1.5 inline-block h-2 w-2 bg-status-green align-middle" /> stable — in use, holding</li>
              <li><span className="mr-1.5 inline-block h-2 w-2 bg-status-amber align-middle" /> idle — slack past the deadband, slowly shrinking</li>
              <li><span className="mr-1.5 inline-block h-2 w-2 bg-status-red align-middle" /> collapsing — unrest teardown, over-capacity, or can't sell</li>
            </ul>
            <p className="mt-1 text-[11px] text-text-tertiary">Bar length = capacity in use (% + magnitude). Green holds below 100% — a little slack is normal.</p>
          </div>
          <div>
            <p className="mb-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">Land bar</p>
            <ul className="space-y-0.5 text-[11px] text-text-secondary">
              <li><span className="mr-1.5 inline-block h-2 w-3 bg-accent align-middle" /> housing &nbsp;<span className="mr-1.5 inline-block h-2 w-3 bg-accent-muted align-middle" /> factories</li>
              <li><span className="mr-1.5 inline-block h-2 w-3 border border-border align-middle" style={{ backgroundImage: COPPER_HATCH }} /> housing can still grow here</li>
              <li><span className="mr-1.5 inline-block h-2 w-3 border border-border bg-surface-active align-middle" /> factories only (beyond habitable)</li>
            </ul>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function IndustryPanel({ systemId }: { systemId: string }) {
  const data = useSystemIndustry(systemId);

  if (data.visibility === "unknown") {
    return <EmptyState message="Scan this system with a ship in range to survey its industry." />;
  }

  const { space, deposits, goods, labourFulfillment, buildings, supplyChain, unrest, economyShardGroup } = data;

  if (buildings.length === 0) {
    return <EmptyState message="Undeveloped — no industry established. Charted deposits await development." />;
  }

  // System health from the per-building used totals (the idle gap the decay loop runs on).
  const totalBuilt = buildings.reduce((s, b) => s + b.count, 0);
  const totalUsed = buildings.reduce((s, b) => s + b.used, 0);
  const idleFraction = totalBuilt > 0 ? Math.max(0, (totalBuilt - totalUsed) / totalBuilt) : 0;
  const sysHealth = industryHealth({ labourFulfillment, unrest, idleFraction, unrestDecayThreshold: THRESHOLD });

  // Per-building health for the tally (rows recompute it themselves — cheap, keeps them self-contained).
  const tally: Record<IndustryHealth, number> = { thriving: 0, coasting: 0, declining: 0 };
  for (const b of buildings) {
    tally[buildingHealth({ used: b.used, built: b.count, unrest, unrestDecayThreshold: THRESHOLD })]++;
  }

  // Group by land pool: deposit (tier 0 extractors) vs general (housing tier -1 + factories tier 1+).
  const extractors = buildings.filter((b) => b.tier === 0);
  const housing = buildings.filter((b) => b.tier === -1);
  const factories = buildings.filter((b) => b.tier >= 1);

  const depositByResource = new Map(deposits.map((d) => [d.resource, d]));
  const supplyByGood = new Map(supplyChain.map((s) => [s.goodId, s]));

  // General-pool slices: housing footprint, factory footprint, then free split by the habitable cap.
  const generalFree = Math.max(0, space.general - space.generalUsed);
  const factoryFootprint = Math.max(0, space.generalUsed - space.habitableUsed);
  const habitableHeadroom = Math.max(0, space.habitable - space.habitableUsed);
  const habFree = Math.min(generalFree, habitableHeadroom);
  const factoryOnlyFree = Math.max(0, generalFree - habFree);

  const hasFlow = goods.some((g) => g.production > 0 || g.consumption > 0);

  const yieldFor = (b: BuildingEntry) => {
    const resource = BUILDING_TYPES[b.buildingType]?.resource;
    return resource ? depositByResource.get(resource) : undefined;
  };

  return (
    <div className="space-y-4">
      {/* System health strip */}
      <Card variant="bordered" padding="md">
        <div className="flex items-center gap-2.5">
          <Badge color={HEALTH[sysHealth].badge}>{HEALTH[sysHealth].sys}</Badge>
          <span className="ml-auto flex items-center gap-3.5 font-mono text-xs text-text-secondary">
            <span>unrest <span className="text-text-primary">{unrest.toFixed(2)}</span></span>
            <span>labour <span className="text-text-primary">{Math.round(labourFulfillment * 100)}%</span></span>
            <LegendTooltip />
          </span>
        </div>
        <p className="mt-1.5 flex gap-3 font-mono text-[11px]">
          <span className="text-status-green-light">{tally.thriving} stable</span>
          <span className="text-status-amber-light">{tally.coasting} idle</span>
          <span className="text-status-red-light">{tally.declining} collapsing</span>
        </p>
      </Card>

      {/* Deposit land — extractors */}
      {extractors.length > 0 && (
        <Card variant="bordered" padding="md">
          <PoolHeader title="Deposit land" sub="extractors" used={space.depositWorked} total={space.deposit} />
          <LandBar
            segments={[
              { key: "worked", width: pct(space.depositWorked, space.deposit), className: "bg-accent-muted" },
            ]}
          />
          <div className="mt-2.5 -mx-1">
            {extractors.map((b) => {
              const dep = yieldFor(b);
              return <BuildingRow key={b.buildingType} b={b} unrest={unrest} yieldMult={dep?.yieldMult} yieldBand={dep?.band} />;
            })}
          </div>
        </Card>
      )}

      {/* General land — housing + factories share the pool */}
      <Card variant="bordered" padding="md">
        <PoolHeader title="General land" sub="housing + factories" used={space.generalUsed} total={space.general} />
        <LandBar
          segments={[
            { key: "housing", width: pct(space.habitableUsed, space.general), className: "bg-accent" },
            { key: "factory", width: pct(factoryFootprint, space.general), className: "bg-accent-muted" },
            { key: "habfree", width: pct(habFree, space.general), className: "border-l border-[#0e1117]", style: { backgroundImage: COPPER_HATCH } },
            { key: "facfree", width: pct(factoryOnlyFree, space.general), className: "border-l border-[#0e1117]" },
          ]}
        />

        {housing.length > 0 && (
          <>
            <RoleLabel>Housing</RoleLabel>
            <div className="-mx-1">
              {housing.map((b) => <BuildingRow key={b.buildingType} b={b} unrest={unrest} />)}
            </div>
          </>
        )}
        {factories.length > 0 && (
          <>
            <RoleLabel>Production</RoleLabel>
            <div className="-mx-1">
              {factories.map((b) => (
                <BuildingRow key={b.buildingType} b={b} unrest={unrest} supply={b.outputGood ? supplyByGood.get(b.outputGood) : undefined} />
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Trade balance — what the base makes vs what the population needs */}
      {hasFlow && (
        <Card variant="bordered" padding="md">
          <SectionHeader as="h4" className="mb-1">Trade balance</SectionHeader>
          <p className="mb-1 text-xs text-text-tertiary">
            What this system&apos;s industry produces against what its population consumes — the net is what it can
            export or must import.
          </p>
          <EconomyCycleCaption shardGroup={economyShardGroup} />
          <SubstrateTradeBars goods={goods} />
        </Card>
      )}
    </div>
  );
}
