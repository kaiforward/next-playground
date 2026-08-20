"use client";

import { Card } from "@/components/ui/card";
import { FactionCard } from "@/components/factions/faction-card";
import { FactionConstructionCard } from "@/components/construction/faction-construction-card";
import { TreasuryCard } from "@/components/factions/treasury-card";
import { VitalTile, VitalGrid, GhostVitalTile } from "@/components/ui/vital-tile";
import { useFaction } from "@/lib/hooks/use-faction";
import { useFactionVitals } from "@/lib/hooks/use-faction-vitals";
import { useFactionTreasury } from "@/lib/hooks/use-faction-treasury";
import { formatPeople, formatUnitsShort, splitCompactNumber } from "@/lib/utils/format";
import { foundingWorkingBalance } from "@/lib/engine/treasury";
import { GRADE } from "@/lib/constants/ui";
import { useLinkComponent } from "@/components/ui/link-provider";

/** Moved from `app/(game)/@panel/factions/[factionId]/page.tsx`. The panel root
 *  (`faction-panel.tsx`) already proved `factionId` names a live faction; the `!result.found` guard
 *  here stays only as a type-narrowing formality — unreachable in practice. */
export function FactionOverview({ factionId }: { factionId: string }) {
  const result = useFaction(factionId);
  const vitals = useFactionVitals(factionId);
  const LinkComponent = useLinkComponent();
  if (!result.found) return null;
  const { faction } = result;
  const treasury = useFactionTreasury(factionId);

  const pop = splitCompactNumber(formatPeople(vitals.population));
  const developedFraction =
    vitals.territorySize > 0 ? (vitals.activeSystemCount / vitals.territorySize) * 100 : 0;

  return (
    <>
      <FactionCard faction={faction} size="md" className="mb-6" />

      {/* Aggregate vitals — the same grid as the system overview, rolled up over the faction's
          systems. Extensive stats (territory, population, development points) sum; stability is
          population-weighted so spreading into small systems doesn't dilute it. */}
      <VitalGrid columns={4}>
        <VitalTile
          label="Territory"
          dotColor="var(--color-text-tertiary)"
          value={String(vitals.territorySize)}
          meter={{ pct: developedFraction, color: "var(--color-text-tertiary)" }}
          hint={`${vitals.activeSystemCount} developed`}
        />
        <VitalTile
          label="Population"
          dotColor={GRADE.unskilled.color}
          value={pop.value}
          unit={pop.unit}
          hint={`across ${vitals.activeSystemCount} system${vitals.activeSystemCount === 1 ? "" : "s"}`}
        />
        <VitalTile
          label="Stability"
          dotColor="var(--color-status-cyan)"
          value={String(Math.round(vitals.stabilityPct))}
          unit="%"
          meter={{ pct: vitals.stabilityPct, color: "var(--color-status-cyan)" }}
          hint="pop-weighted"
        />
        <VitalTile
          label="Development"
          dotColor="var(--color-accent)"
          value={formatUnitsShort(vitals.developmentPoints)}
          meter={{ pct: vitals.developmentPct, color: "var(--color-accent)" }}
          hint={`${Math.round(vitals.developmentPct)}% of potential`}
        />
        <VitalTile
          label="Treasury"
          dotColor="var(--color-accent)"
          // Available money, matching the TreasuryCard headline — the raw balance holds committed
          // founding until settlement, and two surfaces quoting two numbers reads as a bug.
          value={formatUnitsShort(foundingWorkingBalance(treasury.balance, treasury.foundingCommitted))}
          hint={`net ${treasury.net < 0 ? "−" : "+"}${formatUnitsShort(Math.abs(treasury.net))} / cycle`}
        />
        <GhostVitalTile label="Future vitals" colSpan={3} future={<>control · tax base</>} />
      </VitalGrid>

      {/* Government & doctrine — compacted: homeworld link + the flavour the card's badges don't carry. */}
      <Card variant="bordered" padding="sm" className="mb-6">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs">
          <span className="text-text-tertiary">Homeworld</span>
          <LinkComponent
            href={`/system/${faction.homeworldId}`}
            className="text-text-accent hover:text-text-accent-hover transition-colors"
          >
            {faction.homeworldName}
          </LinkComponent>
        </div>
        <p className="text-sm text-text-secondary leading-relaxed">
          <span className="text-text-tertiary">Government — </span>
          {faction.governmentDescription}
        </p>
        <p className="mt-2 text-sm text-text-secondary leading-relaxed">
          <span className="text-text-tertiary">Doctrine — </span>
          {faction.doctrineDescription}
        </p>
      </Card>

      <TreasuryCard factionId={faction.id} interactive={faction.isPlayer} />

      <FactionConstructionCard factionId={faction.id} />
    </>
  );
}
