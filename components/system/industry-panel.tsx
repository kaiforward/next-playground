"use client";

import { useSystemIndustry } from "@/lib/hooks/use-system-industry";
import { GOODS } from "@/lib/constants/goods";
import { HOUSING_TYPE } from "@/lib/constants/industry";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { StatList, StatRow } from "@/components/ui/stat-row";

/** Human-readable label for a building type or good id. */
function label(id: string): string {
  if (id === HOUSING_TYPE) return "Housing";
  return GOODS[id]?.name ?? id;
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

  const { buildSpace, labourFulfillment, buildings, supplyChain } = data;

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
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-3">Industrial base</SectionHeader>
        <div className="space-y-3">
          <ProgressBar
            label="Build space"
            value={buildSpace.used}
            max={buildSpace.total}
            color="copper"
            formatValue={(n) => n.toFixed(0)}
          />
          <ProgressBar
            label="Labour"
            value={labourFulfillment}
            max={1}
            color="copper"
            formatValue={(n) => `${(n * 100).toFixed(0)}%`}
          />
        </div>

        {buildings.length === 0 ? (
          <EmptyState message="No industry built here yet." />
        ) : (
          <div className="mt-4 space-y-4">
            {tierGroups.map(({ tier, entries }) => (
              <div key={tier}>
                <p className="mb-1.5 text-xs font-display font-semibold uppercase tracking-wider text-text-tertiary">
                  {TIER_LABELS[tier] ?? `Tier ${tier}`}
                </p>
                <StatList>
                  {entries.map((b) => (
                    <StatRow key={b.buildingType} label={label(b.buildingType)}>
                      <span className="font-mono text-sm text-text-primary">{b.count}</span>
                    </StatRow>
                  ))}
                </StatList>
              </div>
            ))}
          </div>
        )}
      </Card>

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
    </div>
  );
}
