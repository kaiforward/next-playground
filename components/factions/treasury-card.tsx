"use client";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { FundingSlider } from "@/components/form/funding-slider";
import { TaxLevelStepper } from "@/components/factions/tax-level-stepper";
import { useFactionTreasury, useUpdateTreasuryPolicy } from "@/lib/hooks/use-faction-treasury";
import { TREASURY } from "@/lib/constants/treasury";
import { buildingLabel } from "@/lib/engine/construction-readout";
import { formatMagnitude } from "@/lib/utils/format";
import type { TaxLevel } from "@/lib/types/game";
import type { TreasuryBands } from "@/lib/engine/treasury";

function money(n: number): string {
  return formatMagnitude(n);
}

function signedMoney(n: number): string {
  return `${n < 0 ? "−" : "+"}${money(Math.abs(n))}`;
}

function LedgerRow({ label, amount, indent = false }: { label: string; amount: string; indent?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between py-0.5 text-sm ${indent ? "pl-4 text-text-tertiary" : ""}`}>
      <span className={indent ? "" : "text-text-secondary"}>{label}</span>
      <span className="font-mono text-xs">{amount}</span>
    </div>
  );
}

export interface TreasuryCardProps {
  factionId: string;
  /** True only for the player's faction — AI factions render the same ledger and controls, inert. */
  interactive: boolean;
}

/**
 * The faction treasury — a single-column ledger (balance, itemised income and
 * expenses from the last settlement) over the policy controls (band funding
 * sliders + tax stance). Renders on every faction's panel. Expense amounts
 * are money actually paid; the maintenance breakdown (collapsed by default)
 * shows the bill's composition by building type.
 */
export function TreasuryCard({ factionId, interactive }: TreasuryCardProps) {
  const data = useFactionTreasury(factionId);
  const update = useUpdateTreasuryPolicy(factionId);

  const s = data.lastSettlement;

  const commitBand = (band: keyof TreasuryBands) => (value: number) =>
    update.mutate({ bands: { ...data.bands, [band]: value } });
  const commitTaxLevel = (taxLevel: TaxLevel) => update.mutate({ taxLevel });

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader
        title="Treasury"
        subtitle={
          <>
            <span className="font-mono text-text-primary">{money(data.balance)}</span> ·{" "}
            <span className={`font-mono ${data.net < 0 ? "text-status-red-light" : "text-status-green-light"}`}>
              net {signedMoney(data.net)} / month
            </span>
          </>
        }
      />
      <CardContent>
        {!s ? (
          <EmptyState
            className="mb-4"
            message="No settlement yet — the first collection lands on the next month pulse."
          />
        ) : (
          <>
            <SectionHeader as="h4" className="mb-1">
              Income — last settlement
            </SectionHeader>
            <LedgerRow label="Heads tax" amount={signedMoney(s.headsIncome)} />
            <LedgerRow label="Production tax" amount={signedMoney(s.productionIncome)} />

            <SectionHeader as="h4" className="mt-3 mb-1">
              Expenses
            </SectionHeader>
            <Disclosure summary={`Maintenance — ${signedMoney(-s.paid.maintenance)}`}>
              {s.maintenanceByType.map((line) => (
                <LedgerRow
                  key={line.buildingType}
                  label={buildingLabel(line.buildingType)}
                  amount={signedMoney(-line.amount)}
                  indent
                />
              ))}
            </Disclosure>
            <LedgerRow label="Logistics" amount={signedMoney(-s.paid.logistics)} />
            <LedgerRow label="Construction" amount={signedMoney(-s.paid.construction)} />
          </>
        )}

        <SectionHeader as="h4" className="mt-4 mb-2">
          Funding
        </SectionHeader>
        <FundingSlider
          label="Maintenance"
          set={data.bands.maintenance}
          runs={data.funded.maintenance}
          floor={TREASURY.MAINTENANCE_SLIDER_FLOOR}
          interactive={interactive}
          onCommit={commitBand("maintenance")}
        />
        <FundingSlider
          label="Logistics"
          set={data.bands.logistics}
          runs={data.funded.logistics}
          interactive={interactive}
          onCommit={commitBand("logistics")}
        />
        <FundingSlider
          label="Construction"
          set={data.bands.construction}
          runs={data.funded.construction}
          interactive={interactive}
          onCommit={commitBand("construction")}
        />

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-text-secondary">Tax level</span>
          <TaxLevelStepper value={data.taxLevel} interactive={interactive} onChange={commitTaxLevel} />
        </div>
      </CardContent>
    </Card>
  );
}
