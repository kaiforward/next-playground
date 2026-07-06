import type { ShipState } from "@/lib/types/game";
import { getShipStatusInfo } from "@/lib/utils/ship";
import { Badge } from "@/components/ui/badge";

interface ShipStatusBadgeProps {
  ship: ShipState;
}

export function ShipStatusBadge({ ship }: ShipStatusBadgeProps) {
  const { label, color } = getShipStatusInfo(ship);
  return <Badge color={color}>{label}</Badge>;
}
