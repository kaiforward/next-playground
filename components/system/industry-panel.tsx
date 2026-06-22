"use client";

import { useSystemIndustry } from "@/lib/hooks/use-system-industry";
import { GOODS } from "@/lib/constants/goods";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { QUALITY_BAND_DOT, QUALITY_BAND_TEXT } from "@/lib/constants/ui";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { SubstrateTradeBars } from "@/components/system/substrate-trade-bars";

/** Human-readable label for a building type or good id. */
function label(id: string): string {
  if (id === HOUSING_TYPE) return "Housing";
  return GOODS[id]?.name ?? id;
}

/** Title-case a resource type ("ore" → "Ore"). */
function resourceLabel(resource: string): string {
  return resource.charAt(0).toUpperCase() + resource.slice(1);
}

const TIER_LABELS: Record<number, string> = {
  [-1]: "Housing",
  0: "Tier 0 · Raw",
  1: "Tier 1 · Refined",
  2: "Tier 2 · Advanced",
};

export function IndustryPanel({ systemId }: { systemId: string }) {
  const data = useSystemIndustry(systemId);

  if (data.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to survey its industry." />
    );
  }

  const { space, deposits, goods, labourFulfillment, buildings, supplyChain } = data;

  // Group buildings by tier in ascending order (array is already sorted tier asc).
  const tierGroups: Array<{ tier: number; entries: typeof buildings }> = [];
  for (const b of buildings) {
    const last = tierGroups[tierGroups.length - 1];
    if (last && last.tier === b.tier) {
      last.entries.push(b);
    } else {
      tierGroups.push({ tier: b.tier, entries: [b] });
    }
  }

  return (
    <div className="space-y-6">
      {/* Development — how much of the system's finite space is built out */}
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-3">Development</SectionHeader>
        <div className="space-y-3">
          <ProgressBar
            label="Labour"
            value={labourFulfillment}
            max={1}
            color="copper"
            formatValue={(n) => `${(n * 100).toFixed(0)}%`}
          />
          <ProgressBar
            label="Deposit land"
            value={space.depositWorked}
            max={space.deposit}
            color="amber"
            formatValue={(n) => n.toFixed(0)}
          />
          <ProgressBar
            label="Habitable land"
            value={space.habitableUsed}
            max={space.habitable}
            color="green"
            formatValue={(n) => n.toFixed(0)}
          />
          <ProgressBar
            label="General space"
            value={space.generalUsed}
            max={space.general}
            color="copper"
            formatValue={(n) => n.toFixed(0)}
          />
        </div>
      </Card>

      {/* Industrial base — the built roster + the extraction it draws from */}
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-3">Industrial base</SectionHeader>
        {buildings.length === 0 ? (
          <EmptyState message="No industry built here yet." />
        ) : (
          <div className="space-y-4">
            {tierGroups.map(({ tier, entries }) => (
              <div key={tier}>
                <p className="mb-1.5 text-xs font-display font-semibold uppercase tracking-wider text-text-tertiary">
                  {TIER_LABELS[tier] ?? `Tier ${tier}`}
                </p>
                <StatList>
                  {entries.map((b) => (
                    <StatRow key={b.buildingType} label={label(b.buildingType)}>
                      <span className="font-mono text-sm text-text-primary">{b.count.toFixed(0)}</span>
                    </StatRow>
                  ))}
                </StatList>
              </div>
            ))}
          </div>
        )}

        {deposits.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-1.5 text-xs font-display font-semibold uppercase tracking-wider text-text-tertiary">
              Extraction · worked / available slots
            </p>
            <ul className="space-y-1">
              {deposits.map((d) => (
                <li
                  key={d.resource}
                  className="flex items-center justify-between gap-2 py-1.5 px-3 bg-surface"
                >
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 ${QUALITY_BAND_DOT[d.band]}`} />
                    <span className="text-sm text-text-primary">{resourceLabel(d.resource)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-sm text-text-secondary">
                      {d.worked.toFixed(0)} / {d.slotCap.toFixed(0)}
                    </span>
                    <span className={`font-mono text-xs ${QUALITY_BAND_TEXT[d.band]}`}>
                      ×{d.yieldMult.toFixed(2)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* Supply chain — tier-1+ recipe input gating */}
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-1">Supply chain</SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          Tier-1+ production draws recipe inputs from local stock. A throttled good can&apos;t source
          enough of an input.
        </p>
        {supplyChain.length === 0 ? (
          <EmptyState message="No refined production in this system." />
        ) : (
          <ul className="space-y-1.5">
            {supplyChain.map((entry) => (
              <li key={entry.goodId} className="py-1.5 px-3 bg-surface">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-primary">{label(entry.goodId)}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-text-secondary">
                      {(entry.inputGate * 100).toFixed(0)}%
                    </span>
                    {entry.inputGate < 1 && (
                      <Badge color={entry.inputGate < 0.5 ? "red" : "amber"}>Throttled</Badge>
                    )}
                  </div>
                </div>
                {entry.throttledBy.length > 0 && (
                  <p className="mt-0.5 text-xs text-text-tertiary">
                    Short: {entry.throttledBy.map(label).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Production & consumption — what the built base makes against what the population needs */}
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-1">Production &amp; consumption</SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          What this system&apos;s industry produces against what its population consumes — the net is
          what it can export or must import.
        </p>
        <SubstrateTradeBars goods={goods} />
      </Card>
    </div>
  );
}
