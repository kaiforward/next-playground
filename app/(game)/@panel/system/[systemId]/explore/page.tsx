"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { enrichTraits } from "@/lib/utils/traits";
import {
  deriveSystemLocations,
  type DerivedLocation,
} from "@/lib/constants/locations";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BadgeColor } from "@/components/ui/badge";

const QUALITY_COLORS: Record<number, BadgeColor> = {
  1: "slate",
  2: "blue",
  3: "purple",
};

function LocationCard({
  location,
  systemId,
}: {
  location: DerivedLocation;
  systemId: string;
}) {
  const isAvailable = location.available;
  const href =
    location.id === "cantina"
      ? `/system/${systemId}/explore/cantina`
      : undefined;

  const content = (
    <Card
      variant="bordered"
      padding="sm"
      className={`transition-colors ${
        isAvailable
          ? "hover:border-accent/50 cursor-pointer"
          : "opacity-50 cursor-default"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5" aria-hidden>
          {location.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text-primary text-sm">
              {location.name}
            </span>
            {location.quality !== null && (
              <Badge color={QUALITY_COLORS[location.quality] ?? "slate"}>
                {location.qualityLabel}
              </Badge>
            )}
            {location.id === "cantina" && (
              <Badge color="amber">Mini-game</Badge>
            )}
            {!isAvailable && (
              <Badge color="slate">Coming soon</Badge>
            )}
          </div>
          <p className="text-xs text-text-tertiary mt-1">
            {location.traitDescription ?? location.description}
          </p>
        </div>
      </div>
    </Card>
  );

  if (href && isAvailable) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

function ExploreContent({ systemId }: { systemId: string }) {
  const { systemInfo } = useSystemInfo(systemId);

  const locations = useMemo(() => {
    const traits = systemInfo?.traits
      ? enrichTraits(systemInfo.traits)
      : [];
    return deriveSystemLocations(traits);
  }, [systemInfo?.traits]);

  const stationLocations = useMemo(
    () => locations.filter((l) => l.category === "station"),
    [locations],
  );

  const systemLocations = useMemo(
    () => locations.filter((l) => l.category === "system"),
    [locations],
  );

  return (
    <div className="space-y-8">
      {/* Orbital Station */}
      <section>
        <SectionHeader className="mb-3">
          Orbital Station
        </SectionHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {stationLocations.map((loc) => (
            <LocationCard
              key={loc.id}
              location={loc}
              systemId={systemId}
            />
          ))}
        </div>
      </section>

      {/* System Locations */}
      {systemLocations.length > 0 && (
        <section>
          <SectionHeader className="mb-3">
            System Locations
          </SectionHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {systemLocations.map((loc) => (
              <LocationCard
                key={loc.id}
                location={loc}
                systemId={systemId}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function ExplorePage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <ExploreContent systemId={systemId} />
    </QueryBoundary>
  );
}
