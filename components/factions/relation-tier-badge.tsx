import { Badge, type BadgeColor } from "@/components/ui/badge";
import type { RelationTier } from "@/lib/constants/relations";

const TIER_COLOR: Record<RelationTier, BadgeColor> = {
  allied: "green",
  friendly: "cyan",
  neutral: "slate",
  unfriendly: "amber",
  hostile: "red",
};

const TIER_LABEL: Record<RelationTier, string> = {
  allied: "Allied",
  friendly: "Friendly",
  neutral: "Neutral",
  unfriendly: "Unfriendly",
  hostile: "Hostile",
};

export function RelationTierBadge({ tier }: { tier: RelationTier }) {
  return <Badge color={TIER_COLOR[tier]}>{TIER_LABEL[tier]}</Badge>;
}

export function getRelationTierColor(tier: RelationTier): BadgeColor {
  return TIER_COLOR[tier];
}

export function getRelationTierLabel(tier: RelationTier): string {
  return TIER_LABEL[tier];
}
