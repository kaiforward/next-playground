"use client";

import Link from "next/link";
import { useFactionConstruction } from "@/lib/hooks/use-faction-construction";
import { useSetAutomation } from "@/lib/hooks/use-construction-orders";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CheckboxInput } from "@/components/form/checkbox-input";
import { formatMagnitude } from "@/lib/utils/format";

/**
 * The faction's construction command summary: the automation switch pair (player faction only),
 * the pool with its base + centres composition, and compact link lists — build-out by system and
 * forming colonies. Detail lives where the thing is built: every link lands on the system's
 * Industry tab.
 */
export function FactionConstructionCard({ factionId }: { factionId: string }) {
  const data = useFactionConstruction(factionId);
  const setAutomation = useSetAutomation();
  const empty = data.buildSystems.length === 0 && data.colonies.length === 0;

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Construction"
        subtitle={
          <>
            pool <span className="font-mono text-text-secondary">{formatMagnitude(data.pool)}</span>/pulse ·{" "}
            <span className="font-mono text-text-secondary">{formatMagnitude(data.poolBase)}</span> base +{" "}
            <span className="font-mono text-text-secondary">{formatMagnitude(data.poolCentres)}</span> centres
            {data.orderedCount > 0 && <> · {data.orderedCount} ordered</>}
          </>
        }
      />
      <CardContent>
        {data.automation && (
          <div className="mb-4 flex gap-2">
            <CheckboxInput
              label="Autonomic build"
              checked={data.automation.build}
              onChange={(build) =>
                setAutomation.mutate({ build, colonisation: data.automation?.colonisation ?? true })
              }
            />
            <CheckboxInput
              label="Autonomic colonisation"
              checked={data.automation.colonisation}
              onChange={(colonisation) =>
                setAutomation.mutate({ build: data.automation?.build ?? true, colonisation })
              }
            />
          </div>
        )}
        {empty ? (
          <EmptyState message="No active construction or expansion." />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <SectionHeader as="h4" className="mb-2">
                Building — {data.buildSystems.reduce((s, x) => s + x.count, 0)} across {data.buildSystems.length} systems
              </SectionHeader>
              <ul>
                {data.buildSystems.map((s) => (
                  <li key={s.systemId} className="flex items-baseline justify-between py-0.5 text-sm">
                    <Link href={`/system/${s.systemId}/industry`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {s.systemName}
                    </Link>
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
                    <Link href={`/system/${c.systemId}/industry`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {c.systemName}
                    </Link>
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
