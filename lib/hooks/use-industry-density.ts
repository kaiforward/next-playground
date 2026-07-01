"use client";

import { useCallback, useEffect, useState } from "react";

export type IndustryDensity = "compact" | "detailed";

const KEY = "industry-density";

function isDensity(v: string | null): v is IndustryDensity {
  return v === "compact" || v === "detailed";
}

/**
 * Persisted Compact/Detailed density for the Industry panel. SSR-safe: renders
 * "compact" on the server + first client paint (so hydration matches), then reads
 * localStorage after mount. Value is validated at the storage boundary.
 */
export function useIndustryDensity(): { density: IndustryDensity; setDensity: (d: IndustryDensity) => void } {
  const [density, setDensityState] = useState<IndustryDensity>("compact");

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (isDensity(stored)) setDensityState(stored);
  }, []);

  const setDensity = useCallback((d: IndustryDensity) => {
    setDensityState(d);
    window.localStorage.setItem(KEY, d);
  }, []);

  return { density, setDensity };
}
