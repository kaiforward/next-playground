"use client";

import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FundingSlider } from "@/components/form/funding-slider";
import { TaxLevelStepper } from "@/components/factions/tax-level-stepper";
import { SegmentedControl } from "@/components/form/segmented-control";
import { useFactionTreasury, useUpdateTreasuryPolicy } from "@/lib/hooks/use-faction-treasury";
import { TREASURY } from "@/lib/constants/treasury";
import { DIRECTED_LOGISTICS } from "@/lib/constants/directed-logistics";
import { buildingLabel } from "@/lib/engine/construction-readout";
import { formatMagnitude, formatSignedMagnitude } from "@/lib/utils/format";
import type { TaxLevel } from "@/lib/types/game";
import { bandShortfall, foundingWorkingBalance, type TreasuryBands } from "@/lib/engine/treasury";
import { TermLabel } from "@/components/ui/term-label";

/** The three stepped stockpile-scale bands, keyed to their step value's string form (the
 *  control's own `value` type must extend `string`, so the numeric steps round-trip through it).
 *  Band names only — the multiplier behind each is never shown to the player. */
const STOCKPILE_SCALE_LABELS: Record<string, string> = { "0.75": "Lean", "1": "Normal", "1.5": "Deep" };
const STOCKPILE_SCALE_OPTIONS = DIRECTED_LOGISTICS.STOCKPILE_SCALE_STEPS.map((step) => ({
  value: String(step),
  label: STOCKPILE_SCALE_LABELS[String(step)] ?? String(step),
}));

/** The step whose string form matches `value`, falling back to the default (Normal, 1) — never an
 *  assertion, since `Array.prototype.find` already returns a member of the literal union. */
function stockpileScaleStepFor(value: string): (typeof DIRECTED_LOGISTICS.STOCKPILE_SCALE_STEPS)[number] {
  return DIRECTED_LOGISTICS.STOCKPILE_SCALE_STEPS.find((step) => String(step) === value) ?? 1;
}

function money(n: number): string {
  return formatMagnitude(n);
}

const signedMoney = formatSignedMagnitude;

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
  const [showMaintenance, setShowMaintenance] = useState(false);

  const s = data.lastSettlement;

  const commitBand = (band: keyof TreasuryBands) => (value: number) =>
    update.mutate({ bands: { ...data.bands, [band]: value } });
  const commitTaxLevel = (taxLevel: TaxLevel) => update.mutate({ taxLevel });

  return (
    <Card variant="bordered" padding="md" className="mb-6">
      <CardHeader title={<TermLabel id="treasury">Treasury</TermLabel>} />
      <CardContent>
        {/* The headline is what the player can actually spend: balance minus what founding has
            already called for. The stored balance only falls at settlement (the single balance
            writer), so mid-cycle the two differ — the footnote reconciles them the moment a colony
            order commits money, and disappears when nothing is committed. */}
        <div className="mb-3 flex items-baseline justify-between">
          <span className="font-mono text-[22px] leading-none text-text-primary">
            {money(foundingWorkingBalance(data.balance, data.foundingCommitted))}
          </span>
          <span className={`font-mono text-xs ${data.net < 0 ? "text-status-red-light" : "text-status-green-light"}`}>
            net {signedMoney(data.net)} / cycle
          </span>
        </div>
        {data.foundingCommitted > 0 && (
          <div className="-mt-2 mb-3 flex items-baseline justify-between text-xs text-text-tertiary">
            <span>committed to founding {signedMoney(-data.foundingCommitted)}</span>
            <span className="font-mono">total {money(data.balance)}</span>
          </div>
        )}
        {!s ? (
          <EmptyState
            className="mb-4"
            message="No settlement yet — the first collection lands on the next cycle start."
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
            <button
              type="button"
              className="flex w-full items-baseline justify-between py-0.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
              aria-expanded={showMaintenance}
              onClick={() => setShowMaintenance((v) => !v)}
            >
              <span>Maintenance {showMaintenance ? "▾" : "▸"}</span>
              <span className="font-mono text-xs">{signedMoney(-s.paid.maintenance)}</span>
            </button>
            {showMaintenance &&
              s.maintenanceByType.map((line) => (
                <LedgerRow
                  key={line.buildingType}
                  label={buildingLabel(line.buildingType)}
                  amount={signedMoney(-line.amount)}
                  indent
                />
              ))}
            <LedgerRow label="Logistics" amount={signedMoney(-s.paid.logistics)} />
            <LedgerRow label="Construction" amount={signedMoney(-s.paid.construction)} />
            <LedgerRow label="Founding" amount={signedMoney(-s.foundingExpense)} />
          </>
        )}

        <SectionHeader as="h4" className="mt-4 mb-2">
          Funding
        </SectionHeader>
        <FundingSlider
          label="Maintenance"
          set={data.bands.maintenance}
          runs={data.funded.maintenance}
          shorted={bandShortfall(data.lastSettlement, "maintenance") !== null}
          floor={TREASURY.MAINTENANCE_SLIDER_FLOOR}
          interactive={interactive}
          onCommit={commitBand("maintenance")}
        />
        <FundingSlider
          label="Logistics"
          set={data.bands.logistics}
          runs={data.funded.logistics}
          shorted={bandShortfall(data.lastSettlement, "logistics") !== null}
          interactive={interactive}
          onCommit={commitBand("logistics")}
        />
        <FundingSlider
          label="Construction"
          set={data.bands.construction}
          runs={data.funded.construction}
          shorted={bandShortfall(data.lastSettlement, "construction") !== null}
          interactive={interactive}
          onCommit={commitBand("construction")}
        />

        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm text-text-secondary">
            <TermLabel id="stockpile">Stockpile</TermLabel>
          </span>
          <div className={`w-40 ${interactive ? "" : "pointer-events-none opacity-60"}`}>
            <SegmentedControl
              name="stockpile-scale"
              ariaLabel="Stockpile"
              value={String(data.stockpileScale)}
              onChange={(value) => {
                if (!interactive) return;
                update.mutate({ stockpileScale: stockpileScaleStepFor(value) });
              }}
              options={STOCKPILE_SCALE_OPTIONS}
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-text-secondary">
            <TermLabel id="taxLevel">Tax level</TermLabel>
          </span>
          <TaxLevelStepper value={data.taxLevel} interactive={interactive} onChange={commitTaxLevel} />
        </div>
      </CardContent>
    </Card>
  );
}
