"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ShipDetailPanel } from "@/components/fleet/ship-detail-panel";
import { PageContainer } from "@/components/ui/page-container";
import { Button } from "@/components/ui/button";
import { BackLink } from "@/components/ui/back-link";

export default function ShipDetailPage({
  params,
}: {
  params: Promise<{ shipId: string }>;
}) {
  const { shipId } = use(params);
  const searchParams = useSearchParams();
  const { fleet, loading } = useFleet();
  const { data: universeData } = useUniverse();
  const { currentTick } = useTickContext();

  // ?from=system-{id} → back to system page; fallback to dashboard
  const from = searchParams.get("from");
  const backHref = from?.startsWith("system-")
    ? `/system/${from.slice(7)}`
    : "/dashboard";

  if (loading || !fleet) {
    return (
      <PageContainer size="sm">
        <h1 className="text-2xl font-bold mb-2">Ship Details</h1>
        <p className="text-white/60">Loading...</p>
      </PageContainer>
    );
  }

  const ship = fleet.ships.find((s) => s.id === shipId);

  if (!ship) {
    return (
      <PageContainer size="sm">
        <h1 className="text-2xl font-bold mb-2">Ship Not Found</h1>
        <p className="text-white/60 mb-4">This ship does not exist or does not belong to you.</p>
        <Button href="/dashboard" variant="ghost" size="sm">
          Back to Command Center
        </Button>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="sm">
      <div className="flex items-center gap-3 mb-6">
        <BackLink href={backHref} />
        <h1 className="text-2xl font-bold">Ship Details</h1>
      </div>

      <ShipDetailPanel ship={ship} currentTick={currentTick} regions={universeData?.regions} playerCredits={fleet.credits} />
    </PageContainer>
  );
}
