"use client";

import { useState, useCallback } from "react";

export interface UseSidebarReturn {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
}

const COOKIE_NAME = "sidebar-collapsed";

function persistCollapsed(value: boolean) {
  // Cookie: available to the server on next request for SSR
  document.cookie = `${COOKIE_NAME}=${value ? "1" : "0"}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function useSidebar(defaultCollapsed = false): UseSidebarReturn {
  const [collapsed, setCollapsedState] = useState(defaultCollapsed);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    persistCollapsed(value);
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      persistCollapsed(next);
      return next;
    });
  }, []);

  return { collapsed, toggle, setCollapsed };
}
