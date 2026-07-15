"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "@/lib/components/Modal";
import { Button } from "@/lib/components/Button";
import { formatHebrewDateTime } from "@/lib/dates";
import { FORM_TYPE_SHORT_LABEL } from "@/lib/parent-signatures/form-definitions";
import type { ParentSignatureViewerData } from "@/lib/actions/parent-signatures";

// Bulk print/export view for every currently ACTIVE signed Teaching
// Practice parent-signature form - one long print-friendly document, one
// form per printed page, so the manager can use the browser's own
// Print -> Save as PDF to produce a single combined PDF. No server-side PDF
// generation here (see getAllActiveTeachingPracticeSignedFormsForAdmin in
// lib/actions/parent-signatures.ts) - same "reconstruct from stored
// snapshots + versioned form-definitions content" approach as the
// single-form ParentSignatureViewModal, just looped over every form instead
// of one. Per-form markup is intentionally duplicated from that component
// rather than shared, since the single viewer's markup is wrapped around
// its own fixed-header/scrollable-middle/footer layout for one form at a
// time - reusing it directly here would mean extracting a shared
// sub-component for a single call site on each side, more risk than benefit
// for now.
export function ParentSignatureBulkPrintModal({
  open,
  onClose,
  fetchData,
}: {
  open: boolean;
  onClose: () => void;
  fetchData: () => Promise<ParentSignatureViewerData[]>;
}) {
  const [data, setData] = useState<ParentSignatureViewerData[] | null | undefined>(undefined);

  // Same DI + fresh-mount-per-open pattern as ParentSignatureViewModal - the
  // parent only ever mounts this while bulkPrintOpen is true and unmounts it
  // entirely on close, so every open re-fetches the current signed-forms
  // batch. Unlike that component, a rejected fetch here is caught and turned
  // into an explicit error state rather than left as an unhandled rejection,
  // since a bulk fetch (N storage calls) has more surface area to fail on.
  useEffect(() => {
    let cancelled = false;
    fetchData()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  // Print isolation: a dedicated DOM node appended directly under <body>,
  // completely outside the Modal's fixed/max-height/overflow-auto/flex
  // subtree. Earlier attempts isolated print output in place (hide
  // everything via `visibility`, absolutely-position the target with
  // `inset: 0`) and produced a correct first page followed by many blank
  // ones: `visibility: hidden` keeps every hidden element's box in the
  // layout (it does not free the space), so the print engine still counted
  // pages against the whole hidden app's height; and `inset: 0` pins both
  // top AND bottom, clamping the print target's own height to one page/
  // viewport instead of letting it grow with its actual (often
  // multi-page) content, so overflow-y-auto silently clipped everything
  // past page 1. Rendering into a real sibling of <body>'s other children
  // sidesteps both: `display: none` on everything except this root actually
  // removes the rest of the app from layout (no reserved height), and the
  // root itself carries no position/height/overflow constraints at all, so
  // its natural (potentially very tall) content paginates across as many
  // real pages as it needs, using only `break-before`/`break-inside` below
  // to control where those page boundaries fall.
  const [printRoot] = useState<HTMLElement | null>(() => {
    if (typeof document === "undefined") return null;
    const el = document.createElement("div");
    el.id = "parent-signature-bulk-print-root";
    return el;
  });

  useEffect(() => {
    if (!printRoot) return;
    document.body.appendChild(printRoot);
    return () => {
      document.body.removeChild(printRoot);
    };
  }, [printRoot]);

  const generatedAt = formatHebrewDateTime(new Date());

  // Shared between the on-screen preview and the print-only portal below so
  // the two can never show different content - same source data, same
  // markup, rendered twice into two different DOM locations (one visible on
  // screen, one visible only when printing; never both at once).
  function renderForms() {
    if (data === undefined) {
      return <p className="text-lg text-muted-foreground">טוען...</p>;
    }
    if (data === null) {
      return <p className="text-base text-danger">שגיאה בטעינת הטפסים החתומים. יש לנסות שוב.</p>;
    }
    if (data.length === 0) {
      return <p className="text-base text-muted-foreground">אין טפסים חתומים לייצוא.</p>;
    }
    return (
      <>
        <div className="print-avoid-break flex flex-col gap-1 border-b border-border pb-4">
          <h3 className="text-xl font-extrabold text-card-foreground md:text-2xl">
            טפסים חתומים — התנסויות מתחילים
          </h3>
          <p className="text-sm text-muted-foreground">סה״כ טפסים חתומים: {data.length}</p>
          <p className="text-xs text-muted-foreground">הופק בתאריך: {generatedAt}</p>
        </div>

        {data.map((form) => (
          <div key={form.signedFormId} className="bulk-print-form-page pt-6">
            <div className="print-avoid-break rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-lg font-bold text-card-foreground md:text-xl">
                {form.childNameSnapshot} — {FORM_TYPE_SHORT_LABEL[form.formType]}
              </p>
              <p className="text-sm text-muted-foreground md:text-base">
                תאריך חתימה: {formatHebrewDateTime(new Date(form.signedAt))} · חתם/ה: {form.signerName} · מחזור:{" "}
                {form.courseCycle}
              </p>
            </div>

            <div className="mt-4 flex flex-col gap-3 text-card-foreground">
              <h4 className="text-xl font-extrabold md:text-2xl">{form.content.title}</h4>
              {form.content.introSections.map((section, idx) => (
                <div key={idx} className="flex flex-col gap-2">
                  {section.paragraphs?.map((p, pIdx) => (
                    <p key={pIdx} className="leading-relaxed text-muted-foreground">
                      {p}
                    </p>
                  ))}
                  {section.bullets && (
                    <ul className="list-inside list-disc leading-relaxed text-muted-foreground">
                      {section.bullets.map((b, bIdx) => (
                        <li key={bIdx}>{b}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="print-avoid-break mt-4 flex flex-col gap-2 rounded-xl border border-border p-4">
              {form.address && (
                <p>
                  <span className="font-semibold text-card-foreground">כתובת: </span>
                  {form.address}
                </p>
              )}
              {form.parentEmail && (
                <p>
                  <span className="font-semibold text-card-foreground">כתובת מייל: </span>
                  {form.parentEmail}
                </p>
              )}
              {form.medicalNotes && (
                <p>
                  <span className="font-semibold text-card-foreground">הערות רפואיות: </span>
                  {form.medicalNotes}
                </p>
              )}
              {form.photoConsent !== null && (
                <p>
                  <span className="font-semibold text-card-foreground">הסכמה לצילום: </span>
                  {form.photoConsent ? "מסכים/ה" : "לא מסכים/ה"}
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {form.content.consentStatements.map((statement) => (
                <p key={statement.key} className="text-card-foreground">
                  {statement.text}
                </p>
              ))}
            </div>

            <div className="print-avoid-break mt-4 rounded-xl border border-border p-4">
              <p>
                <span className="font-semibold text-card-foreground">שם החותם/ת: </span>
                {form.signerName}
              </p>
              {form.signerRole && (
                <p>
                  <span className="font-semibold text-card-foreground">תפקיד החותם/ת: </span>
                  {form.signerRole}
                </p>
              )}
              <p>
                <span className="font-semibold text-card-foreground">תאריך חתימה: </span>
                {formatHebrewDateTime(new Date(form.signedAt))}
              </p>
            </div>

            <div className="print-avoid-break mt-4 flex flex-col gap-2">
              <p className="text-lg font-semibold text-card-foreground">חתימה</p>
              {form.signatureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL from Supabase Storage, not a local/optimizable asset
                <img
                  src={form.signatureUrl}
                  alt={`חתימת ${form.signerName}`}
                  className="h-56 w-full max-w-xl rounded-xl border border-border bg-white object-contain md:h-64"
                />
              ) : (
                <p className="text-sm text-muted-foreground">תמונת החתימה אינה זמינה כרגע.</p>
              )}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              גרסת טופס: {form.formVersion} · מחזור: {form.courseCycle}
            </p>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <Modal open={open} title="טפסים חתומים — התנסויות מתחילים" onClose={onClose} size="large">
        <div className="flex h-full min-h-0 flex-col gap-4">
          {/* Base (non-print) rule keeps the print-only portal root's
              content invisible/out of layout during ordinary use - the
              print override is set in the global-scope style block below,
              targeted by the same #parent-signature-bulk-print-root id. */}
          <style>{`
            #parent-signature-bulk-print-root {
              display: none;
            }
            @media print {
              body > *:not(#parent-signature-bulk-print-root) {
                display: none !important;
              }
              #parent-signature-bulk-print-root {
                display: block;
                width: 100%;
                background: #fff;
                color: #000;
                padding: 24px;
                direction: rtl;
              }
              #parent-signature-bulk-print-root * {
                color: #000 !important;
                background: transparent !important;
                border-color: #999 !important;
              }
              #parent-signature-bulk-print-root .print-avoid-break {
                break-inside: avoid;
              }
              #parent-signature-bulk-print-root .bulk-print-form-page {
                break-before: page;
              }
            }
          `}</style>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-base leading-relaxed print:hidden md:text-lg">
            {renderForms()}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-3 border-t border-border pt-4 print:hidden">
            <Button type="button" variant="secondary" onClick={onClose} className="!px-5 !py-3 !text-base">
              סגירה
            </Button>
            <Button
              type="button"
              onClick={() => window.print()}
              disabled={!data || data.length === 0}
              className="!px-5 !py-3 !text-base"
            >
              הדפסה / שמירה כ-PDF
            </Button>
          </div>
        </div>
      </Modal>

      {printRoot &&
        createPortal(
          <div className="text-base leading-relaxed">{renderForms()}</div>,
          printRoot
        )}
    </>
  );
}
