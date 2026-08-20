"use client";

import { use } from "react";
import { SystemPanel } from "@/components/panels/system-panel";

export default function LogisticsPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return <SystemPanel systemId={systemId} tab="logistics" />;
}
