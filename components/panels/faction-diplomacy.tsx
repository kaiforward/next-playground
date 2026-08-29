"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { EventIcon } from "@/components/events/event-icon";
import {
  RelationTierBadge,
  getRelationTierColor,
  getRelationTierLabel,
} from "@/components/factions/relation-tier-badge";
import { RelationsMatrix } from "@/components/factions/relations-matrix";
import { useFaction } from "@/lib/hooks/use-faction";
import { useRelations } from "@/lib/hooks/use-relations";
import { EVENT_DEFINITIONS } from "@/lib/constants/events";
import { RELATION_TIERS, RELATIONS_FREQUENCY } from "@/lib/constants/relations";
import { EVENT_TYPE_BADGE_COLOR } from "@/lib/constants/ui";
import type { FactionRelatedEvent } from "@/lib/services/factions";
import { formatDate, formatDuration } from "@/lib/utils/calendar";
import { useLinkComponent } from "@/components/ui/link-provider";
import { TermLabel } from "@/components/ui/term-label";

/** Moved from `app/(game)/@panel/factions/[factionId]/diplomacy/page.tsx`. */
export function FactionDiplomacy({ factionId }: { factionId: string }) {
  const result = useFaction(factionId);
  const LinkComponent = useLinkComponent();
  if (!result.found) return null;
  const { faction } = result;

  return (
    <>
      <Card variant="bordered" padding="md" className="mb-6">
        <CardHeader
          title={<>Active <TermLabel id="alliance">Alliances</TermLabel></>}
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
                  <LinkComponent
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
                  </LinkComponent>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-xs text-text-tertiary">
                      formed {formatDate(a.formedAtTick)}
                    </div>
                    {a.pendingDissolutionAtTick !== null && (
                      <Badge color="amber" className="mt-1">
                        Dissolving {formatDate(a.pendingDissolutionAtTick)}
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card variant="bordered" padding="md" className="mb-6">
        <CardHeader
          title="Diplomatic Stance"
          subtitle={
            <>
              <TermLabel id="relationScore">Score</TermLabel> with every other faction. Positive =
              friendly, negative = hostile.
            </>
          }
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
                  <LinkComponent
                    href={`/factions/${r.otherFactionId}`}
                    className="flex-1 min-w-0 font-display text-sm text-text-primary hover:text-text-accent transition-colors truncate"
                  >
                    {r.otherFactionName}
                  </LinkComponent>
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

      <Card variant="bordered" padding="md" className="mb-6">
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

      <GalaxyRelationsCard />
    </>
  );
}

/** The galaxy-wide pair-score matrix — every faction against every other, not just this panel's.
 *  Lives on this tab since the standalone Diplomacy destination folded into the faction panel. */
function GalaxyRelationsCard() {
  const { relations } = useRelations();

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Galaxy Relations"
        subtitle={`Pair scores across every faction, drifting every ${formatDuration(RELATIONS_FREQUENCY)}. Click a faction name to inspect it.`}
      />
      <CardContent>
        {relations.factions.length === 0 ? (
          <EmptyState message="No factions present. Reseed the universe to populate the political layer." />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-text-tertiary font-display uppercase tracking-wider">
                <TermLabel id="relationTiers">Legend</TermLabel>
              </span>
              {RELATION_TIERS.map((t) => (
                <Badge key={t.tier} color={getRelationTierColor(t.tier)}>
                  {getRelationTierLabel(t.tier)} ({t.minScore} … {t.maxScore})
                </Badge>
              ))}
            </div>
            <RelationsMatrix data={relations} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecentEventRow({ event }: { event: FactionRelatedEvent }) {
  const def = EVENT_DEFINITIONS[event.type];
  const phaseDef = def?.phases.find((p) => p.name === event.phase);
  const LinkComponent = useLinkComponent();
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
              <LinkComponent
                href={`/factions/${event.otherFactionId}`}
                className="text-text-accent hover:text-text-accent-hover transition-colors"
              >
                {event.otherFactionName}
              </LinkComponent>
            </>
          )}
          {event.systemName && event.systemId && (
            <>
              <span className="text-text-tertiary">·</span>
              <LinkComponent
                href={`/system/${event.systemId}`}
                className="text-text-accent hover:text-text-accent-hover transition-colors"
              >
                {event.systemName}
              </LinkComponent>
            </>
          )}
        </div>
      </div>
      <span className="text-xs font-mono text-text-tertiary shrink-0">
        {formatDate(event.startTick)}
      </span>
    </li>
  );
}

function formatScore(score: number): string {
  const rounded = Math.round(score);
  return rounded >= 0 ? `+${rounded}` : `${rounded}`;
}
