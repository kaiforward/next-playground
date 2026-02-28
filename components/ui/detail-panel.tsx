"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { tv } from "tailwind-variants";

/* ------------------------------------------------------------------ */
/*  Variants                                                           */
/* ------------------------------------------------------------------ */

const panel = tv({
  base: "absolute inset-0 z-30 flex items-center justify-center",
  slots: {
    backdrop: "absolute inset-0 transition-opacity duration-200",
    content:
      "relative bg-surface border border-border rounded-lg shadow-2xl flex flex-col overflow-hidden transition-all duration-200",
    header:
      "flex items-center justify-between px-6 py-4 border-b border-border shrink-0",
    title: "text-lg font-bold font-display text-text-primary",
    subtitle: "text-sm text-text-secondary mt-0.5",
    closeBtn:
      "p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors",
    body: "flex-1 overflow-y-auto p-6",
  },
  variants: {
    size: {
      md: { content: "w-[min(720px,80%)] h-[90%]" },
      lg: { content: "w-[min(960px,85%)] h-[90%]" },
      xl: { content: "w-[min(1200px,90%)] h-[90%]" },
    },
  },
  defaultVariants: { size: "md" },
});

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface DetailPanelProps {
  title: string;
  subtitle?: React.ReactNode;
  headerAction?: React.ReactNode;
  size?: "md" | "lg" | "xl";
  children: React.ReactNode;
}

export function DetailPanel({ title, subtitle, headerAction, size, children }: DetailPanelProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const styles = panel({ size });
  const [mounted, setMounted] = useState(false);

  // Trigger enter animation after first paint
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const close = useCallback(() => {
    router.push("/");
  }, [router]);

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
    <div className={styles.base()}>
      {/* Transparent backdrop — click to close */}
      <div
        className={styles.backdrop()}
        style={{ opacity: mounted ? 1 : 0 }}
        onClick={close}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={styles.content()}
        style={{
          opacity: mounted ? 1 : 0,
          transform: mounted ? "scale(1)" : "scale(0.97)",
        }}
        role="dialog"
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
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={styles.body()}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Close icon (Heroicons x-mark 20×20)                                */
/* ------------------------------------------------------------------ */

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="w-5 h-5"
    >
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}
