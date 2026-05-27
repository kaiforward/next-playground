import { DataTable, type Column } from "@/components/ui/data-table";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StandingBadge } from "./standing-badge";
import type { PlayerFactionReputationInfo } from "@/lib/services/reputation";

const COLUMNS: Column<PlayerFactionReputationInfo>[] = [
  {
    key: "faction",
    label: "Faction",
    sortable: true,
    getValue: (r) => r.factionName,
    render: (r) => (
      <span className="flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-sm"
          style={{ backgroundColor: r.factionColor }}
          aria-hidden
        />
        <span className="font-display text-text-primary">{r.factionName}</span>
      </span>
    ),
  },
  {
    key: "score",
    label: "Score",
    sortable: true,
    getValue: (r) => r.score,
    render: (r) => (
      <span className="font-mono tabular-nums text-text-primary">
        {r.score >= 0 ? "+" : ""}
        {r.score.toFixed(1)}
      </span>
    ),
  },
  {
    key: "standing",
    label: "Standing",
    sortable: true,
    getValue: (r) => r.standing,
    render: (r) => <StandingBadge standing={r.standing} />,
  },
  {
    key: "buy",
    label: "Buy ×",
    sortable: true,
    getValue: (r) => r.buyMultiplier,
    render: (r) => (
      <span className="font-mono tabular-nums text-text-secondary">
        {r.buyMultiplier.toFixed(2)}
      </span>
    ),
  },
  {
    key: "sell",
    label: "Sell ×",
    sortable: true,
    getValue: (r) => r.sellMultiplier,
    render: (r) => (
      <span className="font-mono tabular-nums text-text-secondary">
        {r.sellMultiplier.toFixed(2)}
      </span>
    ),
  },
];

interface ReputationPanelProps {
  reputations: PlayerFactionReputationInfo[];
}

export function ReputationPanel({ reputations }: ReputationPanelProps) {
  return (
    <Card>
      <CardHeader
        title="Faction Standings"
        subtitle="Reputation accrues with successful trade and missions. Hostile factions refuse to deal with you."
      />
      <CardContent>
        <DataTable
          columns={COLUMNS}
          data={reputations}
          getKey={(r) => r.factionId}
        />
      </CardContent>
    </Card>
  );
}
