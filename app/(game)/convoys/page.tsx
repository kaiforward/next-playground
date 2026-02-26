"use client";

import { useConvoys } from "@/lib/hooks/use-convoy";
import { ConvoyStatus } from "@/components/fleet/convoy-status";
import { PageContainer } from "@/components/ui/page-container";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ConvoysContent() {
  const { convoys } = useConvoys();

  return <ConvoyStatus convoys={convoys} />;
}

export default function ConvoysPage() {
  return (
    <PageContainer>
      <h1 className="text-2xl font-bold mb-6">Convoys</h1>

      <QueryBoundary>
        <ConvoysContent />
      </QueryBoundary>
    </PageContainer>
  );
}
