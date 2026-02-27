"use client";

import { useConvoys } from "@/lib/hooks/use-convoy";
import { ConvoyStatus } from "@/components/fleet/convoy-status";
import { DetailPanel } from "@/components/ui/detail-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ConvoysContent() {
  const { convoys } = useConvoys();

  return <ConvoyStatus convoys={convoys} />;
}

export default function ConvoysPanelPage() {
  return (
    <DetailPanel title="Convoys">
      <QueryBoundary>
        <ConvoysContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
