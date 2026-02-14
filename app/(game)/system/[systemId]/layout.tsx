"use client";

import { use } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUniverse } from "@/lib/hooks/use-universe";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { ECONOMY_BADGE_COLOR } from "@/lib/constants/ui";

export default function SystemLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
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
    { label: "Shipyard", href: `${basePath}/shipyard`, active: pathname.startsWith(`${basePath}/shipyard`) },
  ];

  return (
    <PageContainer size="lg">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link
          href={`/map?systemId=${systemId}`}
          className="text-white/40 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold">
          {systemInfo?.name ?? "System"}
        </h1>
        {systemInfo && (
          <>
            <Badge color={ECONOMY_BADGE_COLOR[systemInfo.economyType]}>
              {systemInfo.economyType}
            </Badge>
            {systemInfo.isGateway && (
              <Badge color="amber">Gateway</Badge>
            )}
          </>
        )}
      </div>

      {regionInfo && (
        <p className="text-sm text-white/40 mb-1">
          Region: <span className="text-white/60">{regionInfo.name}</span>
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
    </PageContainer>
  );
}
