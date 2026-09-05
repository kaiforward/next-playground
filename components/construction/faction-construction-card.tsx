"use client";

import { useLinkComponent } from "@/components/ui/link-provider";
import { useFactionConstruction } from "@/lib/hooks/use-faction-construction";
import { useFactionTreasury } from "@/lib/hooks/use-faction-treasury";
import { useSetAutomation } from "@/lib/hooks/use-construction-orders";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CheckboxInput } from "@/components/form/checkbox-input";
import { formatMagnitude, fractionPct } from "@/lib/utils/format";
import { bandShortfall } from "@/lib/engine/treasury";
import { laneHref } from "@/lib/utils/route-hrefs";

/**
 * The faction's construction command summary: the automation switch pair (player faction only),
 * the pool with its base + centres composition, and compact link lists — build-out by system and
 * forming colonies. Detail lives where the thing is built: every link lands on the system's
 * Industry tab.
 */
export function FactionConstructionCard({ factionId }: { factionId: string }) {
  const LinkComponent = useLinkComponent();
  const data = useFactionConstruction(factionId);
  const treasury = useFactionTreasury(factionId);
  const runsPct = fractionPct(treasury.funded.construction);
  // Shorted is decided inside the last settlement — what it paid against what it asked for — not by
  // comparing that latched figure with the live slider, which the player can move at any time with
  // no re-settle. See `bandShortfall`.
  const shorted = bandShortfall(treasury.lastSettlement, "construction") !== null;
  const setAutomation = useSetAutomation();
  const empty = data.buildSystems.length === 0 && data.colonies.length === 0 && data.lanes.length === 0;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Construction"
        subtitle={
          <>
            pool <span className="font-mono text-text-secondary">{formatMagnitude(data.pool)}</span>/cyc ·{" "}
            <span className="font-mono text-text-secondary">{formatMagnitude(data.poolBase)}</span> base +{" "}
            <span className="font-mono text-text-secondary">{formatMagnitude(data.poolCentres)}</span> centres
            {" "}· funded{" "}
            <span className={`font-mono ${shorted ? "text-status-amber-light" : "text-text-secondary"}`}>
              {runsPct}%
            </span>
            {shorted && <span className="text-status-amber-light"> — shorted</span>}
            {data.orderedCount > 0 && <> · {data.orderedCount} ordered</>}
          </>
        }
      />
      <CardContent>
        {data.automation && (
          <div className="mb-4 flex flex-wrap gap-2">
            <CheckboxInput
              label="Autonomic build"
              checked={data.automation.build}
              onChange={(build) =>
                setAutomation.mutate({
                  build,
                  colonisation: data.automation?.colonisation ?? true,
                  lanes: data.automation?.lanes ?? true,
                })
              }
            />
            <CheckboxInput
              label="Autonomic colonisation"
              checked={data.automation.colonisation}
              onChange={(colonisation) =>
                setAutomation.mutate({
                  build: data.automation?.build ?? true,
                  colonisation,
                  lanes: data.automation?.lanes ?? true,
                })
              }
            />
            <CheckboxInput
              label="Autonomic lanes"
              checked={data.automation.lanes}
              onChange={(lanes) =>
                setAutomation.mutate({
                  build: data.automation?.build ?? true,
                  colonisation: data.automation?.colonisation ?? true,
                  lanes,
                })
              }
            />
          </div>
        )}
        {empty ? (
          <EmptyState message="No active construction or expansion." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <SectionHeader as="h4" className="mb-2">
                Building — {data.buildSystems.reduce((s, x) => s + x.count, 0)} across {data.buildSystems.length} systems
              </SectionHeader>
              <ul>
                {data.buildSystems.map((s) => (
                  <li key={s.systemId} className="flex items-baseline justify-between py-0.5 text-sm">
                    <LinkComponent href={`/system/${s.systemId}/industry`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {s.systemName}
                    </LinkComponent>
                    <span className="font-mono text-xs text-text-secondary">{s.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionHeader as="h4" className="mb-2">Colonies forming — {data.colonies.length}</SectionHeader>
              <ul>
                {data.colonies.map((c) => (
                  <li key={c.systemId} className="py-0.5 text-sm">
                    <LinkComponent href={`/system/${c.systemId}/industry`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {c.systemName}
                    </LinkComponent>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionHeader as="h4" className="mb-2">Lanes — {data.lanes.length}</SectionHeader>
              <ul>
                {data.lanes.map((l) => (
                  <li key={l.laneKey} className="py-0.5 text-sm">
                    <LinkComponent href={laneHref(l.laneKey)} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {l.label}
                    </LinkComponent>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
