/**
 * Pure interval WRITE/DELETE planning primitives for dated trainee history
 * (Stage GH1A).
 *
 * PURE by construction: no Prisma, no DB access, no transactions, no clock, no
 * environment access, no logging. These primitives PLAN operations over
 * plain-data interval rows WITHOUT applying them, returning a structured plan
 * (inserts / updates / deletes plus `resultingRows`) that a later stage can
 * translate into a single transaction. They never mutate their inputs.
 *
 * INTERVAL MODEL (locked, GH1A): `effectiveFrom` inclusive; `effectiveTo`
 * EXCLUSIVE; `effectiveTo === null` open-ended; DATE-ONLY `YYYY-MM-DD` keys;
 * generic value payload `V`; no timezone logic (see ./interval-resolver).
 *
 * See COURSE-ARCHITECTURE-HANDOFF.md — GRP-3/GRP-4 (dated membership,
 * close-and-open, non-overlap, one active per enrollment; history never
 * overwritten).
 */

import {
  compareDateKeys,
  isValidDateKey,
  type DateKey,
  type IntervalRow,
} from "./interval-resolver";

/** Input for an UPSERT of the value effective from `effectiveFrom`. */
export interface IntervalWriteInput<V> {
  /** The effective-from date-only key at which the new value applies. */
  effectiveFrom: DateKey;
  /** The value payload to store from `effectiveFrom` onward. */
  value: V;
  /** Id to assign IF the plan inserts a new row (ignored on same-date update). */
  newId: string;
}

/** Target selector for a delete/correction plan. */
export type IntervalDeleteTarget =
  | { by: "id"; id: string }
  | { by: "effectiveFrom"; effectiveFrom: DateKey };

/** A single planned mutation; plain-data and Prisma-independent. */
export type IntervalOperation<V> =
  | { type: "insert"; row: IntervalRow<V> }
  | { type: "update"; id: string; row: IntervalRow<V> }
  | { type: "delete"; id: string };

/** A structured, verifiable plan: the ops plus the sorted resulting rows. */
export interface IntervalPlan<V> {
  operations: IntervalOperation<V>[];
  resultingRows: IntervalRow<V>[];
}

/** A structured validation error (never thrown; returned in results). */
export interface IntervalValidationError {
  code: string;
  message: string;
  rowId?: string;
  effectiveFrom?: DateKey;
}

/** Discriminated result of a planning call. */
export type IntervalPlanResult<V> =
  | { ok: true; plan: IntervalPlan<V> }
  | { ok: false; errors: IntervalValidationError[] };

function byEffectiveFromAsc<V>(a: IntervalRow<V>, b: IntervalRow<V>): number {
  return compareDateKeys(a.effectiveFrom, b.effectiveFrom);
}

/**
 * Validate the invariants of an EXISTING set of interval rows.
 *
 * Detects and reports (as structured errors, never silently):
 *  - malformed date-only keys on `effectiveFrom`/`effectiveTo`
 *  - a closed interval whose `effectiveTo <= effectiveFrom` (zero-width/inverted)
 *  - duplicate `effectiveFrom`
 *  - overlapping rows
 *  - more than one open-ended (`effectiveTo === null`) row
 *  - an open-ended row followed by another row (open-ended must be last)
 *
 * Intentional gaps (a closed row followed by a later row starting after the
 * previous `effectiveTo`) are LEGAL and never reported. Never mutates input.
 */
export function validateIntervalRows<V>(
  rows: readonly IntervalRow<V>[],
): IntervalValidationError[] {
  const errors: IntervalValidationError[] = [];

  for (const row of rows) {
    if (!isValidDateKey(row.effectiveFrom)) {
      errors.push({
        code: "INVALID_DATE_KEY",
        message: `effectiveFrom ${JSON.stringify(row.effectiveFrom)} is not a valid YYYY-MM-DD date`,
        rowId: row.id,
      });
    }
    if (row.effectiveTo !== null && !isValidDateKey(row.effectiveTo)) {
      errors.push({
        code: "INVALID_DATE_KEY",
        message: `effectiveTo ${JSON.stringify(row.effectiveTo)} is not a valid YYYY-MM-DD date`,
        rowId: row.id,
      });
    }
  }
  // Cannot safely compare further if any key is malformed.
  if (errors.length > 0) {
    return errors;
  }

  for (const row of rows) {
    if (row.effectiveTo !== null && compareDateKeys(row.effectiveTo, row.effectiveFrom) <= 0) {
      errors.push({
        code: "NON_POSITIVE_INTERVAL",
        message: `effectiveTo must be strictly after effectiveFrom (row ${row.id})`,
        rowId: row.id,
        effectiveFrom: row.effectiveFrom,
      });
    }
  }

  const openEndedRows = rows.filter((row) => row.effectiveTo === null);
  if (openEndedRows.length > 1) {
    errors.push({
      code: "MULTIPLE_OPEN_ENDED",
      message: `at most one open-ended row is allowed (found ${openEndedRows.length})`,
    });
  }

  const sorted = [...rows].sort(byEffectiveFromAsc);
  for (let i = 1; i < sorted.length; i += 1) {
    if (compareDateKeys(sorted[i - 1].effectiveFrom, sorted[i].effectiveFrom) === 0) {
      errors.push({
        code: "DUPLICATE_EFFECTIVE_FROM",
        message: `duplicate effectiveFrom ${sorted[i].effectiveFrom}`,
        rowId: sorted[i].id,
        effectiveFrom: sorted[i].effectiveFrom,
      });
    }
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current.effectiveTo === null) {
      errors.push({
        code: "OPEN_ENDED_NOT_LAST",
        message: `open-ended row ${current.id} is followed by a later row`,
        rowId: current.id,
        effectiveFrom: current.effectiveFrom,
      });
    } else if (compareDateKeys(current.effectiveTo, next.effectiveFrom) > 0) {
      errors.push({
        code: "OVERLAPPING_INTERVALS",
        message: `row ${current.id} overlaps row ${next.id}`,
        rowId: current.id,
        effectiveFrom: current.effectiveFrom,
      });
    }
  }

  return errors;
}

/**
 * Finalize a plan: defensively reject any planned zero-width/inverted row,
 * sort the resulting rows, re-verify the resulting-set invariants, and wrap.
 */
function finalizePlan<V>(
  operations: IntervalOperation<V>[],
  resultingRows: IntervalRow<V>[],
): IntervalPlanResult<V> {
  for (const operation of operations) {
    if (operation.type === "insert" || operation.type === "update") {
      const row = operation.row;
      if (row.effectiveTo !== null && compareDateKeys(row.effectiveTo, row.effectiveFrom) <= 0) {
        return {
          ok: false,
          errors: [
            {
              code: "PLANNED_NON_POSITIVE_INTERVAL",
              message: `planned row ${row.id} has effectiveTo <= effectiveFrom`,
              rowId: row.id,
              effectiveFrom: row.effectiveFrom,
            },
          ],
        };
      }
    }
  }

  const sortedResult = [...resultingRows].sort(byEffectiveFromAsc);
  const resultErrors = validateIntervalRows(sortedResult);
  if (resultErrors.length > 0) {
    return { ok: false, errors: resultErrors };
  }

  return { ok: true, plan: { operations, resultingRows: sortedResult } };
}

/**
 * Plan an UPSERT of `input.value` effective from `input.effectiveFrom`.
 *
 * Never applies anything and never mutates inputs. Cases handled:
 *  A. First-ever row: insert `[F, null]`.
 *  B. Same-`effectiveFrom` correction: update the existing row's value,
 *     PRESERVING its `effectiveTo`; no duplicate; neighbours untouched.
 *  C. Append after the current open-ended last row: close it at F, insert
 *     `[F, null]`.
 *  D. Insert between rows: the containing row's `effectiveTo` becomes F, the
 *     new row's `effectiveTo` becomes the next boundary; the next row is
 *     unchanged.
 *  E. Insert before the first row: the new row's `effectiveTo` becomes the
 *     first row's `effectiveFrom`; no invented prehistory, no overlap.
 *  F. Multiple future rows: only the immediate containing boundary and the
 *     inserted row change; later rows are untouched.
 *  G. Gaps: never inferred/filled — when F sits in an intentional gap only the
 *     new row is inserted (bounded by the next row or open-ended), and the
 *     previous closed row is NOT extended.
 *  H. Rejects any planned zero-width/inverted row (defensive).
 *  I. Rejects invalid EXISTING input via {@link validateIntervalRows}.
 *
 * Returns structured errors (`ok: false`) rather than throwing for bad input.
 */
export function planIntervalWrite<V>(
  rows: readonly IntervalRow<V>[],
  input: IntervalWriteInput<V>,
): IntervalPlanResult<V> {
  if (!isValidDateKey(input.effectiveFrom)) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_INPUT_DATE_KEY",
          message: `input effectiveFrom ${JSON.stringify(input.effectiveFrom)} is not a valid YYYY-MM-DD date`,
        },
      ],
    };
  }

  const existingErrors = validateIntervalRows(rows);
  if (existingErrors.length > 0) {
    return { ok: false, errors: existingErrors };
  }

  const from = input.effectiveFrom;
  const sorted = [...rows].sort(byEffectiveFromAsc);

  // Case B: same-effectiveFrom correction — update value, preserve effectiveTo.
  const exact = sorted.find((row) => compareDateKeys(row.effectiveFrom, from) === 0);
  if (exact) {
    const updated: IntervalRow<V> = { ...exact, value: input.value };
    const operations: IntervalOperation<V>[] = [
      { type: "update", id: exact.id, row: updated },
    ];
    const resultingRows = sorted.map((row) => (row.id === exact.id ? updated : row));
    return finalizePlan(operations, resultingRows);
  }

  // A row strictly containing F (effectiveFrom < F < effectiveTo, or open-ended).
  const containing = sorted.find(
    (row) =>
      compareDateKeys(row.effectiveFrom, from) < 0 &&
      (row.effectiveTo === null || compareDateKeys(row.effectiveTo, from) > 0),
  );

  if (containing) {
    // Cases C / D / F / split: close the containing row at F; the new row
    // inherits the containing row's old end (preserving any next boundary).
    const updatedContaining: IntervalRow<V> = { ...containing, effectiveTo: from };
    const newRow: IntervalRow<V> = {
      id: input.newId,
      effectiveFrom: from,
      effectiveTo: containing.effectiveTo,
      value: input.value,
    };
    const operations: IntervalOperation<V>[] = [
      { type: "update", id: containing.id, row: updatedContaining },
      { type: "insert", row: newRow },
    ];
    const resultingRows = sorted
      .map((row) => (row.id === containing.id ? updatedContaining : row))
      .concat(newRow);
    return finalizePlan(operations, resultingRows);
  }

  // Cases A / E / G: no containing row. F is first-ever, before the first row,
  // or inside an intentional gap / after a closed last row. Bound the new row
  // by the next row's start (or open-ended). Never extend the previous row.
  const next = sorted.find((row) => compareDateKeys(row.effectiveFrom, from) > 0);
  const newRow: IntervalRow<V> = {
    id: input.newId,
    effectiveFrom: from,
    effectiveTo: next ? next.effectiveFrom : null,
    value: input.value,
  };
  const operations: IntervalOperation<V>[] = [{ type: "insert", row: newRow }];
  const resultingRows = sorted.concat(newRow);
  return finalizePlan(operations, resultingRows);
}

/**
 * Plan a DELETE/correction of a single existing row (by id or `effectiveFrom`).
 *
 * Never applies anything and never mutates inputs. Behaviour:
 *  - reconnect: the previous row's `effectiveTo` becomes the next row's
 *    `effectiveFrom`;
 *  - if the deleted row was last, the previous row's `effectiveTo` becomes null
 *    (the previous row reopens);
 *  - if the deleted row was first, the next row is unchanged (no invented
 *    prehistory);
 *  - deleting the only row yields an empty plan;
 *  - an unknown target yields a structured error (never an invented return).
 *
 * Rejects invalid EXISTING input via {@link validateIntervalRows}.
 */
export function planIntervalDelete<V>(
  rows: readonly IntervalRow<V>[],
  target: IntervalDeleteTarget,
): IntervalPlanResult<V> {
  const existingErrors = validateIntervalRows(rows);
  if (existingErrors.length > 0) {
    return { ok: false, errors: existingErrors };
  }

  if (target.by === "effectiveFrom" && !isValidDateKey(target.effectiveFrom)) {
    return {
      ok: false,
      errors: [
        {
          code: "INVALID_INPUT_DATE_KEY",
          message: `target effectiveFrom ${JSON.stringify(target.effectiveFrom)} is not a valid YYYY-MM-DD date`,
        },
      ],
    };
  }

  const sorted = [...rows].sort(byEffectiveFromAsc);
  const index =
    target.by === "id"
      ? sorted.findIndex((row) => row.id === target.id)
      : sorted.findIndex((row) => compareDateKeys(row.effectiveFrom, target.effectiveFrom) === 0);

  if (index === -1) {
    return {
      ok: false,
      errors: [
        {
          code: "UNKNOWN_TARGET",
          message:
            target.by === "id"
              ? `no row with id ${JSON.stringify(target.id)}`
              : `no row with effectiveFrom ${JSON.stringify(target.effectiveFrom)}`,
        },
      ],
    };
  }

  const targetRow = sorted[index];
  const previous = index > 0 ? sorted[index - 1] : null;
  const next = index < sorted.length - 1 ? sorted[index + 1] : null;

  const operations: IntervalOperation<V>[] = [];
  let resultingRows = sorted.filter((_, i) => i !== index);

  if (previous) {
    const reconnected: IntervalRow<V> = {
      ...previous,
      effectiveTo: next ? next.effectiveFrom : null,
    };
    operations.push({ type: "update", id: previous.id, row: reconnected });
    resultingRows = resultingRows.map((row) => (row.id === previous.id ? reconnected : row));
  }

  operations.push({ type: "delete", id: targetRow.id });
  return finalizePlan(operations, resultingRows);
}
