"use client";

import { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  // "large" is opt-in only (near-fullscreen, internally scrollable) - the
  // default "md" case keeps the exact original markup/classes untouched so
  // every existing caller is unaffected.
  size?: "md" | "large";
}

export function Modal({ open, title, onClose, children, size = "md" }: ModalProps) {
  if (!open) return null;

  const isLarge = size === "large";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className={
          isLarge
            ? "flex h-[90vh] w-[95vw] max-w-[1600px] flex-col rounded-xl bg-card p-6 shadow-xl"
            : "w-full max-w-md rounded-xl bg-card p-6 shadow-xl"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`mb-4 flex items-center justify-between ${isLarge ? "shrink-0" : ""}`}>
          <h2 className="text-lg font-semibold text-card-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-card-foreground"
            aria-label="סגור"
            type="button"
          >
            ✕
          </button>
        </div>
        {/* Large: hand children the full remaining height with no scroll of
            its own - the caller already structures its content as a fixed
            header/scrollable-middle/fixed-footer, so a second scroll region
            here would only fight the caller's for the same space. */}
        {isLarge ? <div className="min-h-0 flex-1">{children}</div> : children}
      </div>
    </div>
  );
}
