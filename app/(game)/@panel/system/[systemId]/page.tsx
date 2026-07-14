"use client";

import { use, useMemo, type ReactNode } from "react";
import { useEvents } from "@/lib/hooks/use-events";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useUniverse } from "@/lib/hooks/use-universe";
import { Card, CardContent } from "@/components/ui/card";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { SystemConstructionSection } from "@/components/construction/system-construction-section";
import { StarGlyph } from "@/components/system/star-glyph";
import { SystemDangerBadge } from "@/components/system/system-danger-badge";
import { formatPeople } from "@/lib/utils/format";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { useSystemVitals } from "@/lib/hooks/use-system-vitals";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GRADE } from "@/lib/constants/ui";
import {
  VitalTile,
  VitalGrid,
  GhostVitalTile,
  CompositionBar,
} from "@/components/ui/vital-tile";
import type { GovernmentType } from "@/lib/types/game";

/**
 * Splits a compact magnitude string (e.g. "2.42M", "980K", "0") into its numeric
 * value and unit suffix, so a VitalTile can render the unit small. Matches the
 * shape `formatPeople`'s Intl compact-notation output always takes.
 */
function splitMagnitude(formatted: string): { value: string; unit?: string } {
  const match = formatted.match(/^([\d.,]+)([A-Za-z]*)$/);
  if (!match) return { value: formatted };
  const [, value, unit] = match;
  return { value, unit: unit || undefined };
}

// ── Quiet context strip — a tight 2-up key/value row, deliberately smaller
// than the vitals grid (no tall StatList). ──

function ContextRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-primary">{children}</span>
    </div>
  );
}

// ── Main content ───────────────────────────────────────────────

function SystemOverviewContent({ systemId }: { systemId: string }) {
  const { events } = useEvents();
  const { systemInfo, regionInfo } = useSystemInfo(systemId);
  const { data: universeData } = useUniverse();
  const substrate = useSystemSubstrate(systemId);
  const vitals = useSystemVitals(systemId);

  // Owning faction (the source of government). Falls back to the region's
  // dominant faction when a system has no factionId yet.
  const factionInfo = useMemo(() => {
    if (!universeData) return null;
    const factionId = systemInfo?.factionId ?? regionInfo?.dominantFactionId ?? null;
    if (!factionId) return null;
    return universeData.factions.find((f) => f.id === factionId) ?? null;
  }, [universeData, systemInfo?.factionId, regionInfo?.dominantFactionId]);

  const systemEvents = useMemo(
    () => events.filter((e) => e.systemId === systemId),
    [events, systemId],
  );

  // Danger — sourced from the system's owning faction's government. Region
  // dominant gov is the fallback when a system has no factionId yet.
  const govType: GovernmentType =
    factionInfo?.governmentType ?? regionInfo?.dominantGovernmentType ?? "frontier";
  const govDef = GOVERNMENT_TYPES[govType];

  // Vitals grid — stability / development / population, each fed by the live tick-invalidated
  // read. A non-economically-active system reports "unknown"; render a muted placeholder in
  // its place rather than a blank/crashing grid.
  const vitalsSection: ReactNode =
    vitals.visibility === "visible" ? (
      (() => {
        const { stability, development, population } = vitals;
        const pop = splitMagnitude(formatPeople(population.headcount));
        return (
          <VitalGrid columns={4}>
            <VitalTile
              label="Stability"
              dotColor="var(--color-status-cyan)"
              value={String(Math.round(stability.pct))}
              unit="%"
              meter={{ pct: stability.pct, color: "var(--color-status-cyan)" }}
              hint={`unrest ${stability.unrest.toFixed(2)}`}
            />
            <VitalTile
              label="Development"
              dotColor="var(--color-accent)"
              value={String(Math.round(development.pct))}
              unit="%"
              meter={{ pct: development.pct, color: "var(--color-accent)" }}
              hint={`${Math.round(development.points)} pts${development.pct < 100 ? " · room to grow" : ""}`}
            />
            <VitalTile
              label="Population"
              dotColor={GRADE.unskilled.color}
              value={pop.value}
              unit={pop.unit}
              colSpan={2}
            >
              <CompositionBar
                segments={[
                  { label: "Unsk", value: population.composition.unskilled, color: GRADE.unskilled.color },
                  { label: "Tech", value: population.composition.technicians, color: GRADE.skill1.color },
                  { label: "Eng", value: population.composition.engineers, color: GRADE.skill2.color },
                  { label: "Unemployed", value: population.composition.unemployed, color: "var(--color-surface-active)" },
                ]}
              />
            </VitalTile>
            <GhostVitalTile
              label="Future vitals"
              colSpan={4}
              future={
                <>
                  control · treasury
                  <br />
                  tax base · logistics
                </>
              }
            />
          </VitalGrid>
        );
      })()
    ) : (
      <Card variant="bordered" padding="md" className="mb-[14px]">
        <EmptyState message="This system isn't developed yet — no vitals to show." />
      </Card>
    );

  return (
    <>
      {/* Events banner */}
      {systemEvents.length > 0 && (
        <Card variant="bordered" padding="md" className="mb-6">
          <CardContent>
            <ActiveEventsSection events={systemEvents} />
          </CardContent>
        </Card>
      )}

      {/* Vitals grid — loud stability / development / population, + a ghost tile for future stats */}
      {vitalsSection}

      {/* Context strip — quiet, tight 2-up. Region + Gateway already surface in the panel header. */}
      <Card variant="bordered" padding="sm" className="mb-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <ContextRow label="Faction">
            {factionInfo ? (
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 border border-border-strong"
                  style={{ backgroundColor: factionInfo.color }}
                />
                {factionInfo.name}
              </span>
            ) : (
              <span className="text-text-tertiary">—</span>
            )}
          </ContextRow>
          <ContextRow label="Government">
            <span className="capitalize">{govDef.name}</span>
          </ContextRow>
          <ContextRow label="Danger">
            <SystemDangerBadge systemId={systemId} baseDanger={govDef.dangerBaseline} />
          </ContextRow>
          <ContextRow label="Astrography">
            {substrate.visibility === "visible" ? (
              <span className="inline-flex items-center gap-1.5">
                <StarGlyph sunClass={substrate.sunClass} size="sm" />
                {SUN_CLASSES[substrate.sunClass].name} · {substrate.bodies.length} bodies
              </span>
            ) : (
              <span className="text-text-tertiary">—</span>
            )}
          </ContextRow>
        </div>
      </Card>

      {/* Construction — in-flight builds / a forming colony (hidden when nothing is under way on a developed world) */}
      <SystemConstructionSection systemId={systemId} />
    </>
  );
}

export default function SystemOverviewPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <SystemOverviewContent systemId={systemId} />
    </QueryBoundary>
  );
}
