"use client";

import { use } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";

function ShipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.655 5.655a2.122 2.122 0 11-3-3l5.655-5.655m1.06-1.06l1.06-1.06a3.5 3.5 0 014.95 0l.707.707a3.5 3.5 0 010 4.95l-1.06 1.06m-7.07-7.07l3.535-3.536a3.5 3.5 0 014.95 0l.707.707a3.5 3.5 0 010 4.95l-3.535 3.536" />
    </svg>
  );
}

function HubCard({
  href,
  title,
  description,
  icon,
  accentClass,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  accentClass: string;
}) {
  return (
    <Link href={href} className="block group">
      <Card variant="bordered" padding="lg" className={`transition-colors ${accentClass}`}>
        <div className="flex items-center gap-4">
          <div className="shrink-0 text-white/60 group-hover:text-white transition-colors">
            {icon}
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="text-sm text-white/40 mt-0.5">{description}</p>
          </div>
        </div>
      </Card>
    </Link>
  );
}

export default function ShipyardPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  const basePath = `/system/${systemId}/shipyard`;

  return (
    <div className="space-y-4">
      <HubCard
        href={`${basePath}/purchase`}
        title="Ship Dealer"
        description="Browse and purchase new vessels"
        icon={<ShipIcon />}
        accentClass="hover:border-blue-500/50"
      />
      <HubCard
        href={`${basePath}/upgrades`}
        title="Upgrade Bay"
        description="Install and manage ship modules"
        icon={<WrenchIcon />}
        accentClass="hover:border-purple-500/50"
      />
    </div>
  );
}
