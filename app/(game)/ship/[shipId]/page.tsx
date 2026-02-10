"use client";

import { use } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ShipDetailPanel } from "@/components/fleet/ship-detail-panel";
import { PageContainer } from "@/components/ui/page-container";
import Link from "next/link";

export default function ShipDetailPage({
  params,
}: {
  params: Promise<{ shipId: string }>;
}) {
  const { shipId } = use(params);
  const { fleet, loading } = useFleet();
  const { currentTick } = useTickContext();

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
        <Link
          href="/dashboard"
          className="text-indigo-400 hover:text-indigo-300 text-sm"
        >
          Back to Command Center
        </Link>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="sm">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/dashboard"
          className="text-white/40 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold">Ship Details</h1>
      </div>

      <ShipDetailPanel ship={ship} currentTick={currentTick} />
    </PageContainer>
  );
}
