"use client";

import { DetailPanel } from "@/components/ui/detail-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { ReputationPanel } from "@/components/factions/reputation-panel";
import { useFactionReputation } from "@/lib/hooks/use-faction-reputation";

function ReputationContent() {
  const { reputations } = useFactionReputation();
  return <ReputationPanel reputations={reputations} />;
}

export default function ReputationPanelPage() {
  return (
    <DetailPanel
      title="Reputation"
      subtitle="Your standing with each faction. Rises with successful trade and missions; hostile factions refuse to deal with you."
      size="lg"
    >
      <QueryBoundary>
        <ReputationContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
