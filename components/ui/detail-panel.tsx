"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { tv } from "tailwind-variants";
import { X } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Variants                                                           */
/* ------------------------------------------------------------------ */

const panel = tv({
  slots: {
    base: "fixed left-0 bottom-0 top-[var(--topbar-height)] z-30 w-[clamp(400px,30vw,560px)] bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden transition-all duration-200",
    header:
      "flex items-center justify-between px-6 py-4 border-b border-border shrink-0",
    title: "text-lg font-bold font-display text-text-primary",
    subtitle: "text-sm text-text-secondary mt-0.5",
    closeBtn:
      "p-1.5 rounded text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors",
    body: "flex-1 overflow-y-auto p-6 [scrollbar-gutter:stable]",
  },
});

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface DetailPanelProps {
  title: string;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  /** Path to navigate to when the panel is closed (default: "/"). */
  backPath?: string;
  children: React.ReactNode;
}

export function DetailPanel({ title, subtitle, headerAction, backPath = "/", children }: DetailPanelProps) {
  const router = useRouter();
  const styles = panel();
  const [mounted, setMounted] = useState(false);

  // Trigger enter animation after first paint
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const close = useCallback(() => {
    router.push(backPath);
  }, [router, backPath]);

  // Close on Escape — only when focus is not inside an input/textarea/select
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const tag = e.target instanceof HTMLElement ? e.target.tagName : "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close]);

  return (
    <aside
      className={styles.base()}
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateX(0)" : "translateX(-100%)",
      }}
      aria-label={title}
    >
      {/* Header */}
      <div className={styles.header()}>
        <div>
          <h2 className={styles.title()}>{title}</h2>
          {subtitle && <div className={styles.subtitle()}>{subtitle}</div>}
        </div>
        <div className="flex items-center gap-2">
          {headerAction}
          <button
            onClick={close}
            className={styles.closeBtn()}
            aria-label="Close panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className={styles.body()}>
        {children}
      </div>
    </aside>
  );
}
