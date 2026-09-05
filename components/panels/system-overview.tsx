"use client";

import { useMemo, type ReactNode } from "react";
import { useEvents } from "@/lib/hooks/use-events";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useSystemConstruction } from "@/lib/hooks/use-system-construction";
import { Card, CardContent } from "@/components/ui/card";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { EmptyState } from "@/components/ui/empty-state";
import { StarGlyph } from "@/components/system/star-glyph";
import { SystemDangerBadge } from "@/components/system/system-danger-badge";
import { formatPeople, splitCompactNumber } from "@/lib/utils/format";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { useSystemVitals } from "@/lib/hooks/use-system-vitals";
import { ColonySection } from "@/components/construction/colony-section";
import { ClaimSection } from "@/components/construction/claim-section";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { GRADE } from "@/lib/constants/ui";
import { VitalTile, VitalGrid, GhostVitalTile } from "@/components/ui/vital-tile";
import { CompositionBar } from "@/components/ui/composition-bar";
import { BADGE_COLOR_VAR } from "@/components/ui/badge";
import { bandLabel, bandTone } from "@/components/system/provision-view";
import { useLinkComponent } from "@/components/ui/link-provider";
import { TermLabel } from "@/components/ui/term-label";
import type { GovernmentType } from "@/lib/types/game";

// ── Quiet context strip — a tight 2-up key/value row, deliberately smaller
// than the vitals grid (no tall StatList). ──

function ContextRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-text-tertiary">{label}</span>
      <span className="text-text-primary">{children}</span>
    </div>
  );
}

// ── Main content ───────────────────────────────────────────────

/** Moved from `app/(game)/@panel/system/[systemId]/page.tsx`'s `SystemOverviewContent` — the panel
 *  root (`system-panel.tsx`) already proved `systemId` names a live system before this ever mounts,
 *  so there is no not-found branch here; a non-developed system still renders (its vitals section
 *  shows its own muted placeholder, same as before). */
export function SystemOverview({ systemId }: { systemId: string }) {
  const { events } = useEvents();
  const { systemInfo, regionInfo } = useSystemInfo(systemId);
  const { data: universeData } = useUniverse();
  const substrate = useSystemSubstrate(systemId);
  const vitals = useSystemVitals(systemId);
  const construction = useSystemConstruction(systemId);
  const LinkComponent = useLinkComponent();

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
        const { stability, development, population, provision } = vitals;
        const pop = splitCompactNumber(formatPeople(population.headcount));
        return (
          <VitalGrid columns={3}>
            <VitalTile
              label={<TermLabel id="stability">Stability</TermLabel>}
              dotColor="var(--color-status-cyan)"
              value={String(Math.round(stability.pct))}
              unit="%"
              meter={{ pct: stability.pct, color: "var(--color-status-cyan)" }}
            />
            <VitalTile
              label={<TermLabel id="developmentPoints">Development</TermLabel>}
              dotColor="var(--color-accent)"
              value={String(Math.round(development.pct))}
              unit="%"
              meter={{ pct: development.pct, color: "var(--color-accent)" }}
              hint={`${Math.round(development.points)} pts${development.pct < 100 ? " · room to grow" : ""}`}
            />
            <VitalTile
              label="Construction"
              dotColor="var(--color-status-amber)"
              value={String(construction.visibility === "visible" ? construction.projects.length : 0)}
              hint={
                <LinkComponent
                  href={`/system/${systemId}/industry`}
                  className="text-text-accent transition-colors hover:text-text-accent-hover"
                >
                  → Industry
                </LinkComponent>
              }
            />
            <VitalTile
              label={<TermLabel id="population">Population</TermLabel>}
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
            {provision.assessed ? (
              <VitalTile
                label="Provisioned"
                dotColor={BADGE_COLOR_VAR[bandTone(provision.band)]}
                value={String(Math.round(provision.pct))}
                unit="%"
                meter={{
                  pct: provision.pct,
                  color: BADGE_COLOR_VAR[bandTone(provision.band)],
                  markerPct: provision.expectationPct,
                }}
                hint={<TermLabel id="provisionBands">{bandLabel(provision.band)}</TermLabel>}
              />
            ) : (
              <VitalTile
                label="Provisioned"
                dotColor="var(--color-text-tertiary)"
                value="—"
                hint="Not yet assessed"
              />
            )}
            <GhostVitalTile
              label="Future vitals"
              colSpan={3}
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

      {/* Colony surface — the founding entry for a controlled, not-yet-developed system. No-ops
          (renders null) once the system is developed or has nothing forming. */}
      <ColonySection systemId={systemId} />

      {/* Claim surface — the counterpart entry for an unclaimed system bordering the player's
          territory. No-ops (renders null) everywhere else, including a foreign or non-adjacent
          unclaimed system. */}
      <ClaimSection systemId={systemId} systemName={systemInfo?.name ?? ""} />

      {/* Context strip — quiet, tight 2-up. Region + Gateway already surface in the panel header. */}
      <Card variant="bordered" padding="sm" className="mb-6">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <ContextRow label={<TermLabel id="faction">Faction</TermLabel>}>
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
          <ContextRow label={<TermLabel id="government">Government</TermLabel>}>
            <span className="capitalize">{govDef.name}</span>
          </ContextRow>
          <ContextRow label={<TermLabel id="danger">Danger</TermLabel>}>
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
    </>
  );
}
