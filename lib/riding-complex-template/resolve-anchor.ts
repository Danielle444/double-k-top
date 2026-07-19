// Fix 3, Stage 1 - anchor resolver for the dormant complex-plan template core.
//
// PURE by construction: the ONLY import is the sibling plain-data `types`
// module. No Prisma, no DB, no next/headers, no auth/session/cookies, no env,
// NO hidden clock (`Date.now()` / argless `new Date()`), no random, no
// `localeCompare`, no locale/timezone. Every answer is derived solely from the
// explicit descriptors passed in.
//
// PURPOSE: given the linked schedule items behind one riding slot, decide
// whether they can anchor a template (a single group + an anchor date) and, if
// so, expose deterministic start-time metadata. This is the trust gate for
// product decision A (a null/ambiguous/both-groups destination yields no
// template) expressed as an eligibility result.
//
// CONTRACT (locked):
//  - No items                              -> ineligible NO_SCHEDULE_ITEMS
//  - Any malformed date key                -> ineligible INVALID_DATE_KEY
//  - Any null/empty group                  -> ineligible MISSING_GROUP
//  - Group names differ across items        -> ineligible AMBIGUOUS_GROUP
//  - Group comparison is EXACT string equality (no trim/lowercase/normalize).
//  - Anchor date = the earliest valid `YYYY-MM-DD` across the linked items.
//  - Start-time metadata = the earliest `startTime` among items sharing the
//    anchor date, with the anchor item chosen deterministically (earliest
//    startTime, then smallest id) so ties never depend on input order.
//  - Never mutates the input; never throws for ordinary malformed input.

import type {
  AnchorIneligibleReason,
  AnchorResolution,
  LinkedScheduleItemDescriptor,
} from "./types";

// Strict `YYYY-MM-DD` shape. Purely structural: we never construct a `Date`,
// so no timezone conversion (and no clock) is ever involved. For zero-padded
// ISO date-only strings, plain string `<`/`>` ordering equals chronological
// ordering.
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * True only for a real `YYYY-MM-DD` calendar day: correct shape, in-range month
 * (01-12) and day (honouring leap years). Rejects non-strings, wrong shapes,
 * and impossible dates like `2026-02-30`. No `Date` construction.
 */
function isValidDateKey(value: string): boolean {
  if (!DATE_KEY_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) {
    return false;
  }
  let maxDay = DAYS_IN_MONTH[month - 1];
  if (month === 2 && isLeapYear(year)) {
    maxDay = 29;
  }
  return day >= 1 && day <= maxDay;
}

function ineligible(reason: AnchorIneligibleReason): AnchorResolution {
  return Object.freeze({ eligible: false as const, reason });
}

/**
 * Resolve the anchor for a riding slot from its linked schedule items.
 *
 * Returns a frozen discriminated {@link AnchorResolution}: `eligible: true`
 * with the anchor date, the single resolved group, and deterministic
 * start-time metadata; otherwise `eligible: false` with a stable, non-PII
 * reason code. Input order does not affect the result, and the input array and
 * its descriptors are never mutated.
 */
export function resolveAnchor(
  items: readonly LinkedScheduleItemDescriptor[]
): AnchorResolution {
  if (!Array.isArray(items) || items.length === 0) {
    return ineligible("NO_SCHEDULE_ITEMS");
  }

  // Fail closed on an unusable element rather than throwing on a runtime array
  // that is not the clean, fully-populated shape the type promises: a null or
  // undefined entry, or a sparse hole (which `for...of` visits as undefined).
  // Any such element makes the whole set unusable, so we reuse the existing
  // NO_SCHEDULE_ITEMS reason (no new reason code) - there is no usable set of
  // schedule items to anchor from.
  for (const item of items) {
    if (item === null || typeof item !== "object") {
      return ineligible("NO_SCHEDULE_ITEMS");
    }
  }

  // REASON PRECEDENCE: group validation runs BEFORE date validation below, so
  // when a single input violates both (e.g. a null group AND a malformed date),
  // the group reason (MISSING_GROUP / AMBIGUOUS_GROUP) is returned - never the
  // date reason. This ordering is deliberate and must not be changed here.
  //
  // Group must be present (non-null, non-empty) on EVERY item, and identical
  // across all of them by exact string equality. We fix the reference group
  // from the first item and compare the rest to it.
  const firstGroup = items[0].groupName;
  if (typeof firstGroup !== "string" || firstGroup.length === 0) {
    return ineligible("MISSING_GROUP");
  }
  for (const item of items) {
    const group = item.groupName;
    if (typeof group !== "string" || group.length === 0) {
      return ineligible("MISSING_GROUP");
    }
    // Exact equality only - deliberately no trim/lowercase/normalization.
    if (group !== firstGroup) {
      return ineligible("AMBIGUOUS_GROUP");
    }
  }

  // Every linked item must carry a real calendar date. A single malformed date
  // key blocks templating (strict data-integrity gate) rather than being
  // silently skipped.
  for (const item of items) {
    if (typeof item.dateKey !== "string" || !isValidDateKey(item.dateKey)) {
      return ineligible("INVALID_DATE_KEY");
    }
  }

  // Anchor date = the earliest valid date across the items (lexicographic order
  // equals chronological order for valid zero-padded keys).
  let anchorDateKey = items[0].dateKey;
  for (const item of items) {
    if (item.dateKey < anchorDateKey) {
      anchorDateKey = item.dateKey;
    }
  }

  // Deterministic start-time metadata: among the items sharing the anchor date,
  // pick the earliest `startTime`; break exact-time ties by the smallest id so
  // the chosen anchor item never depends on input ordering. `startTime` is
  // compared as an opaque string (never parsed to a clock).
  let anchorItemId = "";
  let anchorStartTime = "";
  let chosen = false;
  for (const item of items) {
    if (item.dateKey !== anchorDateKey) {
      continue;
    }
    const startTime = typeof item.startTime === "string" ? item.startTime : "";
    const id = typeof item.id === "string" ? item.id : "";
    if (
      !chosen ||
      startTime < anchorStartTime ||
      (startTime === anchorStartTime && id < anchorItemId)
    ) {
      anchorStartTime = startTime;
      anchorItemId = id;
      chosen = true;
    }
  }

  return Object.freeze({
    eligible: true as const,
    anchorDateKey,
    resolvedGroup: firstGroup,
    startTime: Object.freeze({ value: anchorStartTime, anchorItemId }),
  });
}
