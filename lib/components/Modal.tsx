"use client";

import { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  // "large" is near-fullscreen, for callers that structure their own fixed
  // header/scrollable-middle/fixed-footer. "wide" is a middle ground for a
  // longer form that still manages its own internal scroll region (like
  // "md" does) but needs more horizontal room than max-w-md - e.g. a
  // multi-section edit form with several labeled fields per row. "xl" is
  // for a document-style viewer (e.g. ParentSignatureViewModal): wider and
  // taller than "wide", and - like "large" - hands children the full
  // remaining height for their own header/scrollable-middle/footer layout
  // instead of a second nested scroll region. The default "md" case keeps
  // the exact original markup/classes untouched so every existing caller is
  // unaffected.
  size?: "md" | "large" | "wide" | "xl";
  // Opt-in override for the header title's text size/weight - defaults to
  // the existing "text-lg font-semibold" for every caller that doesn't pass
  // this, so no existing modal changes. Only the class list, not the
  // element itself - callers still get the same truncate/color/spacing
  // behavior.
  titleClassName?: string;
}

export function Modal({ open, title, onClose, children, size = "md", titleClassName }: ModalProps) {
  if (!open) return null;

  const isLarge = size === "large";
  const isWide = size === "wide";
  const isXl = size === "xl";
  // "large" and "xl" both hand children the full remaining height (see size
  // doc comment above) rather than wrapping them in a second scroll region.
  const givesChildrenFullHeight = isLarge || isXl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:static print:block print:bg-white print:p-0"
      onClick={onClose}
    >
      <div
        className={
          isLarge
            ? "flex h-[90vh] w-[95vw] max-w-[1600px] flex-col rounded-xl bg-card p-6 shadow-xl print:h-auto print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
            : isXl
              ? "flex max-h-[90vh] w-[95vw] max-w-6xl flex-col rounded-xl bg-card p-6 shadow-xl print:h-auto print:max-h-none print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
              : isWide
                ? "w-[95vw] max-w-3xl rounded-xl bg-card p-6 shadow-xl print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
                : "w-full max-w-md rounded-xl bg-card p-6 shadow-xl print:w-auto print:max-w-none print:rounded-none print:p-0 print:shadow-none"
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`mb-4 flex min-w-0 items-center justify-between gap-2 print:hidden ${givesChildrenFullHeight ? "shrink-0" : ""}`}
        >
          <h2 className={`min-w-0 truncate font-semibold text-card-foreground ${titleClassName ?? "text-lg"}`}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-card-foreground"
            aria-label="סגור"
            type="button"
          >
            ✕
          </button>
        </div>
        {/* Large/xl: hand children the full remaining height with no scroll
            of its own - the caller already structures its content as a
            fixed header/scrollable-middle/fixed-footer, so a second scroll
            region here would only fight the caller's for the same space. */}
        {givesChildrenFullHeight ? <div className="min-h-0 flex-1">{children}</div> : children}
      </div>
    </div>
  );
}
