import { Badge, type BadgeColor } from "@/components/ui/badge";
import type { ReputationStanding } from "@/lib/types/game";

const STANDING_COLOR: Record<ReputationStanding, BadgeColor> = {
  champion: "green",
  trusted: "cyan",
  neutral: "slate",
  distrusted: "amber",
  hostile: "red",
};

const STANDING_LABEL: Record<ReputationStanding, string> = {
  champion: "Champion",
  trusted: "Trusted",
  neutral: "Neutral",
  distrusted: "Distrusted",
  hostile: "Hostile",
};

export function StandingBadge({ standing }: { standing: ReputationStanding }) {
  return <Badge color={STANDING_COLOR[standing]}>{STANDING_LABEL[standing]}</Badge>;
}
