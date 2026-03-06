"use client";

import React, { useEffect } from "react";

export function AxeAccessibility() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
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
