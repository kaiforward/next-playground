import { Badge, type BadgeColor } from "@/components/ui/badge";
import type { FactionStatus } from "@/lib/types/game";

const STATUS_COLOR: Record<FactionStatus, BadgeColor> = {
  dominant: "purple",
  major: "blue",
  regional: "cyan",
  minor: "slate",
};

const STATUS_LABEL: Record<FactionStatus, string> = {
  dominant: "Dominant",
  major: "Major",
  regional: "Regional",
  minor: "Minor",
};

export function FactionStatusBadge({ status }: { status: FactionStatus }) {
  return <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>;
}
