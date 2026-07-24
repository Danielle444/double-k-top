"use client";

import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";

/**
 * A THIN confirm/cancel wrapper over the existing Modal.
 *
 * The repository already had a generic Modal shell but no confirmation
 * component, so every confirm dialog was hand-rolled inline (see the archive
 * confirm in MessagesClient). This centralizes only the two-button shape, so the
 * "cancel is the default safe action" and "confirming cannot fire twice"
 * conventions live in one place instead of being re-derived per caller.
 *
 * DELIBERATELY DUMB. It:
 *  - persists nothing (no localStorage/sessionStorage/cookie/env, so a warning
 *    can never be permanently dismissed - a caller could not opt out even if it
 *    wanted to);
 *  - knows nothing about courses, offerings, capabilities or fan-out;
 *  - calls no Server Action and performs no IO of its own;
 *  - owns no business payload - the caller stages its own payload and this
 *    component never sees it;
 *  - introduces no new styling infrastructure, reusing Modal and Button as-is.
 *
 * SAFE-BY-DEFAULT CONTRACT:
 *  - `onCancel` is wired to Modal's `onClose`, so the ✕ button and the backdrop
 *    click both resolve to CANCEL. There is no dismissal path that is not cancel.
 *  - Cancel renders FIRST and as the secondary action; confirming requires an
 *    explicit, deliberate click on the second button. Nothing is autofocused.
 *  - `onConfirm` fires at most once per open: callers clear their staged payload
 *    as the first statement of the handler, which closes this modal, and
 *    `isPending` additionally disables the confirm button as a second layer.
 */
interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Disables the confirm button while the caller's transition is in flight. */
  isPending?: boolean;
  onConfirm: () => void;
  /** Also invoked by the ✕ button and by a backdrop click. */
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  isPending = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal open={open} title={title} onClose={onCancel}>
      <p className="whitespace-pre-wrap text-sm text-card-foreground">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" disabled={isPending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
