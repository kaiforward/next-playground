"use client";

import React, { useEffect } from "react";
import { isDevBuild } from "@/lib/utils/dev-flag";

export function AxeAccessibility() {
  useEffect(() => {
    if (isDevBuild()) {
      Promise.all([
        import("@axe-core/react"),
        import("react-dom"),
      ]).then(([axe, ReactDOM]) => {
        axe.default(React, ReactDOM, 1000);
      });
    }
  }, []);

  return null;
}
