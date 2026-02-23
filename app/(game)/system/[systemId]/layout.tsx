"use client";

import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUniverse } from "@/lib/hooks/use-universe";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { PageContainer } from "@/components/ui/page-container";
import { QueryBoundary } from "@/components/ui/query-boundary";

function SystemLayoutContent({
  systemId,
  children,
}: {
  systemId: string;
  children: React.ReactNode;
}) {
  const { data: universeData } = useUniverse();
  const pathname = usePathname();

  const systemInfo = universeData?.systems.find((s) => s.id === systemId) ?? null;
  const regionInfo = systemInfo
    ? universeData?.regions.find((r) => r.id === systemInfo.regionId) ?? null
    : null;

  const basePath = `/system/${systemId}`;
  const tabs = [
    { label: "Overview", href: basePath, active: pathname === basePath },
    { label: "Market", href: `${basePath}/market`, active: pathname.startsWith(`${basePath}/market`) },
    { label: "Ships", href: `${basePath}/ships`, active: pathname.startsWith(`${basePath}/ships`) },
    { label: "Convoys", href: `${basePath}/convoys`, active: pathname.startsWith(`${basePath}/convoys`) },
    { label: "Shipyard", href: `${basePath}/shipyard`, active: pathname.startsWith(`${basePath}/shipyard`) },
    { label: "Contracts", href: `${basePath}/contracts`, active: pathname.startsWith(`${basePath}/contracts`) },
  ];

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <BackLink href={`/map?systemId=${systemId}`} />
        <h1 className="text-2xl font-bold">
          {systemInfo?.name ?? "System"}
        </h1>
        {systemInfo && (
          <>
            <EconomyBadge economyType={systemInfo.economyType} />
            {systemInfo.isGateway && (
              <Badge color="amber">Gateway</Badge>
            )}
          </>
        )}
      </div>

      {regionInfo && (
        <p className="text-sm text-white/40 mb-1">
          Region: <span className="text-white/60">{regionInfo.name}</span>
          <span className="text-white/30"> &middot; </span>
          <span className="text-white/50 capitalize">
            {regionInfo.dominantEconomy} economy
          </span>
        </p>
      )}

      {systemInfo?.description && (
        <p className="text-white/60 mb-4">{systemInfo.description}</p>
      )}

      {/* Tab bar */}
      <nav className="flex gap-6 border-b border-white/10 mb-6">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`pb-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab.active
                ? "border-indigo-400 text-white"
                : "border-transparent text-white/50 hover:text-white/70"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/* Active tab content */}
      {children}
    </>
  );
}

export default function SystemLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <PageContainer size="lg">
      <QueryBoundary>
        <SystemLayoutContent systemId={systemId}>
          {children}
        </SystemLayoutContent>
      </QueryBoundary>
    </PageContainer>
  );
}
