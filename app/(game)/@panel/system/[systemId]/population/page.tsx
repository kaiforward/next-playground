"use client";

import { use } from "react";
import { PopulationPanel } from "@/components/system/population-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

export default function PopulationPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <PopulationPanel systemId={systemId} />
    </QueryBoundary>
  );
}
