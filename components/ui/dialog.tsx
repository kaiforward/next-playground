"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tv, VariantProps } from "tailwind-variants";

/* ------------------------------------------------------------------ */
/*  useDialog — convenience hook for open/close state                  */
/* ------------------------------------------------------------------ */

export function useDialog(initialOpen = false) {
  const [open, setOpen] = useState(initialOpen);
  return {
    open,
    onOpen: useCallback(() => setOpen(true), []),
    onClose: useCallback(() => setOpen(false), []),
  };
}

/* ------------------------------------------------------------------ */
/*  Dialog — native <dialog> wrapper (modal + non-modal)               */
/* ------------------------------------------------------------------ */

const dialogStyles = tv({
  base: "",
  variants: {
    modal: {
      true: "m-auto max-h-none max-w-none border-none p-6 rounded-xl bg-gray-900 border border-border shadow-2xl backdrop:bg-black/60",
      false: "m-0 max-h-none max-w-none border-none p-0 inset-auto"
    },
    size: {
      sm: "",
      md: "",
      lg: ""
    }
  },
  defaultVariants: {
    size: 'lg'
  },
  compoundVariants: [
    { modal: true, size: 'sm', className: "w-[480px]" },
    { modal: true, size: 'md', className: "w-[780px]" },
    { modal: true, size: 'lg', className: "w-[960px]" },
  ]
})

type DialogProps
  = Omit<React.DialogHTMLAttributes<HTMLDialogElement>, "open"> & 
  VariantProps<typeof dialogStyles> & {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the dialog should close (Escape, cancel, etc.). */
  onClose: () => void;
  /**
   * If true, uses showModal() — browser-native focus trap + backdrop.
   * If false (default), uses .show() — non-blocking, manual Escape handling.
   */
  modal?: boolean;
  /** CSS selector for the element to auto-focus on open. Defaults to "button". */
  initialFocus?: string;
}

export function Dialog({
  open,
  onClose,
  modal = false,
  size,
  initialFocus,
  children,
  className,
  ...props
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Show/hide the native dialog + auto-focus
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      if (modal) {
        dialog.showModal();
      } else {
        dialog.show();
      }

      const selector = initialFocus ?? "button";
      const target = dialog.querySelector<HTMLElement>(selector);
      target?.focus();
    } else if (dialog.open) {
      dialog.close();
    }

    // Restore focus when closing or on unmount
    return () => {
      previousFocus.current?.focus();
    };
  }, [open, modal, initialFocus]);

  // Modal mode: intercept cancel event so React state stays in sync
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !modal) return;

    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", handleCancel);
    return () => dialog.removeEventListener("cancel", handleCancel);
  }, [modal, onClose]);

  // Non-modal mode: handle Escape key manually
  useEffect(() => {
    if (modal || !open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modal, open, onClose]);

  return (
    <dialog
      ref={dialogRef}
      className={dialogStyles({ className, modal, size })}
      {...props}
    >
      {children}
    </dialog>
  );
}
