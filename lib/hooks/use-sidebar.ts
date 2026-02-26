"use client";

import { useState, useCallback } from "react";

export interface UseSidebarReturn {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (value: boolean) => void;
}

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem("sidebar-collapsed") === "true";
}

export function useSidebar(): UseSidebarReturn {
  const [collapsed, setCollapsedState] = useState(readInitial);

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

  return { collapsed, toggle, setCollapsed };
}
