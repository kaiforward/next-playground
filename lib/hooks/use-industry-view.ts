"use client";

import { useCallback, useEffect, useState } from "react";

export type IndustryView = "chipped" | "table";

const KEY = "industry-view";

function isView(v: string | null): v is IndustryView {
  return v === "chipped" || v === "table";
}

/**
 * Persisted Chipped/Table view for the Industry tab's deposit/space breakdown.
 * Chipped (the glanceable default) and Table (the precise alternative) render the
 * same data. SSR-safe: renders "chipped" on the server + first client paint (so
 * hydration matches), then reads localStorage after mount. Validated at the
 * storage boundary.
 */
export function useIndustryView(): { view: IndustryView; setView: (v: IndustryView) => void } {
  const [view, setViewState] = useState<IndustryView>("chipped");

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY);
    if (isView(stored)) setViewState(stored);
  }, []);

  const setView = useCallback((v: IndustryView) => {
    setViewState(v);
    window.localStorage.setItem(KEY, v);
  }, []);

  return { view, setView };
}
