"use client";

import { PURCHASABLE_SHIP_TYPES, type ShipTypeDefinition, type ShipSize } from "@/lib/constants/ships";
import { usePurchaseShipMutation } from "@/lib/hooks/use-purchase-ship-mutation";
import { formatCredits } from "@/lib/utils/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SIZE_ORDER: ShipSize[] = ["small", "medium", "large"];
const SIZE_LABELS: Record<ShipSize, string> = { small: "Small", medium: "Medium", large: "Large" };

import { ROLE_COLORS } from "@/lib/constants/ships";

interface ShipyardPanelProps {
  systemId: string;
  playerCredits: number;
}

export function ShipyardPanel({ systemId, playerCredits }: ShipyardPanelProps) {
  const purchaseMutation = usePurchaseShipMutation();

  // Group by size
  const bySize = new Map<ShipSize, ShipTypeDefinition[]>();
  for (const def of PURCHASABLE_SHIP_TYPES) {
    const list = bySize.get(def.size) ?? [];
    list.push(def);
    bySize.set(def.size, list);
  }

  return (
    <div className="space-y-8">
      {SIZE_ORDER.map((size) => {
        const defs = bySize.get(size);
        if (!defs || defs.length === 0) return null;
        return (
          <div key={size}>
            <h3 className="text-sm font-medium text-white/50 mb-3 uppercase tracking-wider">
              {SIZE_LABELS[size]} Ships
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {defs.map((def) => (
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
          </div>
        );
      })}

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
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-base font-semibold text-white">{def.name}</h4>
        <Badge color={ROLE_COLORS[def.role] ?? "slate"}>{def.role}</Badge>
      </div>

      <p className="text-xs text-white/40 mb-3">{def.description}</p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3 text-xs">
        <StatMini label="Cargo" value={def.cargo} />
        <StatMini label="Fuel" value={def.fuel} />
        <StatMini label="Speed" value={def.speed} />
        <StatMini label="Hull" value={def.hullMax} />
        <StatMini label="Shields" value={def.shieldMax} />
        <StatMini label="Firepower" value={def.firepower} />
        <StatMini label="Evasion" value={def.evasion} />
        <StatMini label="Stealth" value={def.stealth} />
        <StatMini label="Sensors" value={def.sensors} />
        <StatMini label="Crew" value={def.crewCapacity} />
      </div>

      <div className="flex items-center justify-between mb-3">
        <Badge color="amber">{formatCredits(def.price)}</Badge>
        <span className="text-[10px] text-white/30 font-mono">
          {def.slotLayout.engine}E {def.slotLayout.cargo}C {def.slotLayout.defence}D {def.slotLayout.systems}S
        </span>
      </div>

      <Button
        variant="action"
        color="green"
        size="sm"
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

function StatMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/40">{label}</span>
      <span className="text-white/70 font-medium">{value}</span>
    </div>
  );
}
