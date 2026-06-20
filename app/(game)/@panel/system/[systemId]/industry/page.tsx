"use client";

import { use } from "react";
import { IndustryPanel } from "@/components/system/industry-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

export default function IndustryPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <IndustryPanel systemId={systemId} />
    </QueryBoundary>
  );
}
