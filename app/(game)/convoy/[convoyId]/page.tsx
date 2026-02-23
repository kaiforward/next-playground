"use client";

import { use } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { ConvoyDetailCard } from "@/components/fleet/convoy-detail-card";
import { PageContainer } from "@/components/ui/page-container";
import { BackLink } from "@/components/ui/back-link";
import { Button } from "@/components/ui/button";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ConvoyDetailContent({ convoyId }: { convoyId: string }) {
  const { fleet } = useFleet();
  const { convoys } = useConvoys();

  const convoy = convoys.find((c) => c.id === convoyId);

  if (!convoy) {
    return (
      <>
        <h1 className="text-2xl font-bold mb-2">Convoy Not Found</h1>
        <p className="text-white/60 mb-4">
          This convoy does not exist or has been disbanded.
        </p>
        <Button href="/dashboard" variant="ghost" size="sm">
          Back to Command Center
        </Button>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 mb-6">
        <BackLink href={`/system/${convoy.systemId}/convoys`} />
        <h1 className="text-2xl font-bold">Convoy Details</h1>
      </div>

      <ConvoyDetailCard
        convoy={convoy}
        playerCredits={fleet.credits}
        ships={fleet.ships}
        variant="full"
      />
    </>
  );
}

export default function ConvoyDetailPage({
  params,
}: {
  params: Promise<{ convoyId: string }>;
}) {
  const { convoyId } = use(params);

  return (
    <PageContainer size="sm">
      <QueryBoundary>
        <ConvoyDetailContent convoyId={convoyId} />
      </QueryBoundary>
    </PageContainer>
  );
}
