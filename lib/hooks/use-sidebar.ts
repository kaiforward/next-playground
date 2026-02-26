"use client";

import { useState, useCallback, useEffect, useRef } from "react";

export interface UseSidebarReturn {
  collapsed: boolean;
  /** True after the initial localStorage sync — safe to enable CSS transitions. */
  hydrated: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
}

export function useSidebar(): UseSidebarReturn {
  // Always start expanded to match server render, then sync from localStorage
  const [collapsed, setCollapsedState] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const didSync = useRef(false);

  useEffect(() => {
    if (didSync.current) return;
    didSync.current = true;
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsedState(true);
    // Enable transitions on the next frame so the initial sync is instant
    requestAnimationFrame(() => setHydrated(true));
  }, []);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    localStorage.setItem("sidebar-collapsed", String(value));
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }, []);

  return { collapsed, hydrated, toggle, setCollapsed };
}
