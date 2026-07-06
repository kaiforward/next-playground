import type { ShipState } from "@/lib/types/game";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { ROLE_COLORS } from "@/lib/constants/ships";

interface SelectedShipCardProps {
  ship: ShipState;
}

export function SelectedShipCard({ ship }: SelectedShipCardProps) {
  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title={ship.name}
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Badge color={ROLE_COLORS[ship.role] ?? "slate"}>
              {ship.role}
            </Badge>
            <span className="capitalize text-text-secondary">{ship.size}</span>
          </span>
        }
      />
    </Card>
  );
}
