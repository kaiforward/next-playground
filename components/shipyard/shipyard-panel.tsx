"use client";

import { PURCHASABLE_SHIP_TYPES, type ShipTypeDefinition } from "@/lib/constants/ships";
import { usePurchaseShipMutation } from "@/lib/hooks/use-purchase-ship-mutation";
import { formatCredits } from "@/lib/utils/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatList, StatRow } from "@/components/ui/stat-row";

interface ShipyardPanelProps {
  systemId: string;
  playerCredits: number;
}

export function ShipyardPanel({ systemId, playerCredits }: ShipyardPanelProps) {
  const purchaseMutation = usePurchaseShipMutation();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        {PURCHASABLE_SHIP_TYPES.map((def) => (
          <ShipTypeCard
            key={def.id}
            def={def}
            systemId={systemId}
            playerCredits={playerCredits}
            isPurchasing={purchaseMutation.isPending}
            onPurchase={() =>
              purchaseMutation.mutate({ systemId, shipType: def.id })
            }
          />
        ))}
      </div>

      {purchaseMutation.error && (
        <p className="text-sm text-red-400">
          {purchaseMutation.error.message}
        </p>
      )}

      <p className="text-sm text-white/40">
        Your balance: <span className="text-white/70">{formatCredits(playerCredits)}</span>
      </p>
    </div>
  );
}

interface ShipTypeCardProps {
  def: ShipTypeDefinition;
  systemId: string;
  playerCredits: number;
  isPurchasing: boolean;
  onPurchase: () => void;
}

function ShipTypeCard({
  def,
  playerCredits,
  isPurchasing,
  onPurchase,
}: ShipTypeCardProps) {
  const canAfford = playerCredits >= def.price;
  const shortfall = def.price - playerCredits;

  return (
    <Card variant="bordered" padding="md">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">{def.name}</h3>
        <Badge color="amber">{formatCredits(def.price)}</Badge>
      </div>

      <p className="text-sm text-white/50 mb-4">{def.description}</p>

      <StatList className="mb-4">
        <StatRow label="Fuel capacity">
          <span className="text-sm text-white">{def.fuel}</span>
        </StatRow>
        <StatRow label="Cargo capacity">
          <span className="text-sm text-white">{def.cargo}</span>
        </StatRow>
      </StatList>

      <Button
        variant="action"
        color="green"
        size="md"
        fullWidth
        disabled={!canAfford || isPurchasing}
        onClick={onPurchase}
      >
        {isPurchasing
          ? "Purchasing..."
          : canAfford
            ? "Buy"
            : `Need ${formatCredits(shortfall)} more`}
      </Button>
    </Card>
  );
}
