"use client";

import Link from "next/link";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { StarGlyph } from "./star-glyph";
import { SUN_CLASSES } from "@/lib/constants/bodies";
import { formatNumber } from "@/lib/utils/format";

/**
 * One-line Astrography summary on the Overview tab, linking across to the
 * Astrography tab. Renders nothing for unsurveyed (unknown) systems.
 */
export function AstrographyTeaser({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);
  if (substrate.visibility === "unknown") return null;

  const { sunClass, bodies, population } = substrate;
  return (
    <Link
      href={`/system/${systemId}/astrography`}
      className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
    >
      <StarGlyph sunClass={sunClass} size="sm" />
      <span>{SUN_CLASSES[sunClass].name}</span>
      <span className="text-text-tertiary">·</span>
      <span>{bodies.length} {bodies.length === 1 ? "body" : "bodies"}</span>
      <span className="text-text-tertiary">·</span>
      <span>
        pop <span className="font-mono">{formatNumber(population)}</span>
      </span>
      <span className="text-text-accent">→</span>
    </Link>
  );
}
