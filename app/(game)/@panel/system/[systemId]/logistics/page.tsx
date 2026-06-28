"use client";

import { use } from "react";
import { LogisticsPanel } from "@/components/system/logistics-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

export default function LogisticsPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <LogisticsPanel systemId={systemId} />
    </QueryBoundary>
  );
}
