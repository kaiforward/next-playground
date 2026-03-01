import type { ShipState } from "@/lib/types/game";
import { getShipStatusInfo } from "@/lib/utils/ship";
import { Badge } from "@/components/ui/badge";

interface ShipStatusBadgeProps {
  ship: ShipState;
  inBattle?: boolean;
}

export function ShipStatusBadge({ ship, inBattle }: ShipStatusBadgeProps) {
  const { label, color } = getShipStatusInfo(ship, inBattle);
  return <Badge color={color}>{label}</Badge>;
}
