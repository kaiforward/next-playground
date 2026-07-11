"use client";

import Link from "next/link";
import { use } from "react";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { EventIcon } from "@/components/events/event-icon";
import { FactionCard } from "@/components/factions/faction-card";
import { FactionConstructionCard } from "@/components/construction/faction-construction-card";
import { FactionStatusBadge } from "@/components/factions/faction-status-badge";
import { RelationTierBadge } from "@/components/factions/relation-tier-badge";
import { useFaction } from "@/lib/hooks/use-faction";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { EVENT_TYPE_BADGE_COLOR } from "@/lib/constants/ui";
import type { FactionRelatedEvent } from "@/lib/services/factions";

function FactionDetailContent({ factionId }: { factionId: string }) {
  const { faction } = useFaction(factionId);

  return (
    <DetailPanel title={faction.name} size="xl" backPath="/factions">
      <FactionCard faction={faction} size="md" className="mb-6" />

      <FactionConstructionCard factionId={faction.id} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card variant="bordered" padding="md">
          <CardHeader title="Government" />
          <CardContent>
            <StatList>
              <StatRow label="Type">
                <Badge color="blue">{faction.governmentName}</Badge>
              </StatRow>
              <StatRow label="Doctrine">
                <Badge color="purple">{faction.doctrineName}</Badge>
              </StatRow>
              <StatRow label="Status">
                <FactionStatusBadge status={faction.status} />
              </StatRow>
              <StatRow label="Homeworld">
                <Link
                  href={`/system/${faction.homeworldId}`}
                  className="text-sm text-text-accent hover:text-text-accent-hover transition-colors"
                >
                  {faction.homeworldName}
                </Link>
              </StatRow>
              <StatRow label="Territory">
                <span className="font-mono text-text-primary">
                  {faction.territorySize} systems
                </span>
              </StatRow>
            </StatList>
            <p className="mt-4 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-tertiary">Doctrine — </span>
              {faction.doctrineDescription}
            </p>
            <p className="mt-2 text-sm text-text-secondary leading-relaxed">
              <span className="text-text-tertiary">Government — </span>
              {faction.governmentDescription}
            </p>
          </CardContent>
        </Card>

        <Card variant="bordered" padding="md">
          <CardHeader
            title="Active Alliances"
            subtitle={
              faction.alliances.length === 0
                ? "No formal pacts."
                : `${faction.alliances.length} pact${faction.alliances.length !== 1 ? "s" : ""}`
            }
          />
          <CardContent>
            {faction.alliances.length === 0 ? (
              <EmptyState message="This faction holds no formal alliances." />
            ) : (
              <ul className="space-y-2">
                {faction.alliances.map((a) => (
                  <li
                    key={a.otherFactionId}
                    className="flex items-center justify-between gap-3 px-3 py-2 bg-surface-hover/40 border-l-2"
                    style={{ borderLeftColor: a.otherFactionColor }}
                  >
                    <Link
                      href={`/factions/${a.otherFactionId}`}
                      className="flex items-center gap-2 min-w-0 hover:text-text-accent transition-colors"
                    >
                      <span
                        aria-hidden
                        className="h-3 w-3 shrink-0 border border-border"
                        style={{ backgroundColor: a.otherFactionColor }}
                      />
                      <span className="font-display text-sm text-text-primary truncate">
                        {a.otherFactionName}
                      </span>
                    </Link>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-xs text-text-tertiary">
                        formed t.{a.formedAtTick}
                      </div>
                      {a.pendingDissolutionAtTick !== null && (
                        <Badge color="amber" className="mt-1">
                          Dissolving t.{a.pendingDissolutionAtTick}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card variant="bordered" padding="md" className="mb-6">
        <CardHeader
          title="Diplomatic Stance"
          subtitle="Score with every other faction. Positive = friendly, negative = hostile."
        />
        <CardContent>
          {faction.relations.length === 0 ? (
            <EmptyState message="No other factions in this universe." />
          ) : (
            <ul className="space-y-1.5">
              {faction.relations.map((r) => (
                <li
                  key={r.otherFactionId}
                  className="flex items-center gap-3 px-3 py-2 bg-surface-hover/40 border-l-2"
                  style={{ borderLeftColor: r.otherFactionColor }}
                >
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 border border-border"
                    style={{ backgroundColor: r.otherFactionColor }}
                  />
                  <Link
                    href={`/factions/${r.otherFactionId}`}
                    className="flex-1 min-w-0 font-display text-sm text-text-primary hover:text-text-accent transition-colors truncate"
                  >
                    {r.otherFactionName}
                  </Link>
                  <span className="font-mono tabular-nums text-sm text-text-primary w-12 text-right">
                    {formatScore(r.score)}
                  </span>
                  <RelationTierBadge tier={r.tier} />
                  {r.hasAlliance && (
                    <Badge color="green" variant="outline">
                      Pact
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card variant="bordered" padding="md">
          <CardHeader
            title="Territory Sample"
            subtitle={
              faction.territorySample.length < faction.territorySize
                ? `Showing ${faction.territorySample.length} of ${faction.territorySize} systems.`
                : `All ${faction.territorySize} systems.`
            }
          />
          <CardContent>
            {faction.territorySample.length === 0 ? (
              <EmptyState message="This faction has no territory." />
            ) : (
              <ul className="space-y-1">
                {faction.territorySample.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/system/${s.id}`}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 bg-surface-hover/40 hover:bg-surface-hover transition-colors"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="font-display text-sm text-text-primary truncate">
                          {s.name}
                        </span>
                        {s.isGateway && (
                          <Badge color="amber">Gateway</Badge>
                        )}
                      </span>
                      <EconomyBadge economyType={s.economyType} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card variant="bordered" padding="md">
          <CardHeader title="Recent Diplomatic Events" />
          <CardContent>
            {faction.recentEvents.length === 0 ? (
              <EmptyState message="No recent border conflicts or pact activity." />
            ) : (
              <ul className="space-y-2">
                {faction.recentEvents.map((ev) => (
                  <RecentEventRow key={ev.id} event={ev} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4">
        <SectionHeader as="h3">Political Map</SectionHeader>
        <p className="text-sm text-text-tertiary">
          Toggle the political overlay on the map to see {faction.name} territory at a glance.
        </p>
      </div>
    </DetailPanel>
  );
}

function RecentEventRow({ event }: { event: FactionRelatedEvent }) {
  const def = EVENT_DEFINITIONS[event.type];
  const phaseDef = def?.phases.find((p) => p.name === event.phase);
  return (
    <li className="flex items-start gap-3 px-3 py-2 bg-surface-hover/40 border-l-2 border-l-accent">
      <span className="pt-0.5 shrink-0 text-text-secondary">
        <EventIcon eventType={event.type} className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">
            {def?.name ?? event.type}
          </span>
          <Badge color={EVENT_TYPE_BADGE_COLOR[event.type] ?? "slate"}>
            {phaseDef?.displayName ?? event.phase}
          </Badge>
        </div>
        <div className="mt-0.5 text-xs text-text-secondary flex items-center gap-2 flex-wrap">
          {event.otherFactionId && event.otherFactionName && (
            <>
              <span className="text-text-tertiary">with</span>
              <Link
                href={`/factions/${event.otherFactionId}`}
                className="text-text-accent hover:text-text-accent-hover transition-colors"
              >
                {event.otherFactionName}
              </Link>
            </>
          )}
          {event.systemName && event.systemId && (
            <>
              <span className="text-text-tertiary">·</span>
              <Link
                href={`/system/${event.systemId}`}
                className="text-text-accent hover:text-text-accent-hover transition-colors"
              >
                {event.systemName}
              </Link>
            </>
          )}
        </div>
      </div>
      <span className="text-xs font-mono text-text-tertiary shrink-0">
        t.{event.startTick}
      </span>
    </li>
  );
}

function formatScore(score: number): string {
  const rounded = Math.round(score);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}

export default function FactionDetailPage({
  params,
}: {
  params: Promise<{ factionId: string }>;
}) {
  const { factionId } = use(params);
  return (
    <QueryBoundary>
      <FactionDetailContent factionId={factionId} />
    </QueryBoundary>
  );
}
