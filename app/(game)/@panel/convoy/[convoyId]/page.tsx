"use client";

import { use } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { ConvoyDetailCard } from "@/components/fleet/convoy-detail-card";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ConvoyPanelContent({ convoyId }: { convoyId: string }) {
  const { fleet } = useFleet();
  const { convoys } = useConvoys();

  const convoy = convoys.find((c) => c.id === convoyId);

  if (!convoy) {
    return (
      <DetailPanel title="Convoy Not Found">
        <p className="text-white/60 mb-4">
          This convoy does not exist or has been disbanded.
        </p>
        <Button href="/" variant="ghost" size="sm">
          Back to Star Map
        </Button>
      </DetailPanel>
    );
  }

  return (
    <DetailPanel title={convoy.name ?? "Convoy"} subtitle={convoy.system.name}>
      <ConvoyDetailCard
        convoy={convoy}
        playerCredits={fleet.credits}
        ships={fleet.ships}
        variant="full"
      />
    </DetailPanel>
  );
}

export default function ConvoyPanelPage({
  params,
}: {
  params: Promise<{ convoyId: string }>;
}) {
  const { convoyId } = use(params);

  return (
    <QueryBoundary>
      <ConvoyPanelContent convoyId={convoyId} />
    </QueryBoundary>
  );
}
