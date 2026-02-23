"use client";

import { use } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { ShipyardPanel } from "@/components/shipyard/shipyard-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

function PurchaseContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();

  return (
    <ShipyardPanel
      systemId={systemId}
      playerCredits={fleet.credits}
    />
  );
}

export default function ShipyardPurchasePage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <PurchaseContent systemId={systemId} />
    </QueryBoundary>
  );
}
