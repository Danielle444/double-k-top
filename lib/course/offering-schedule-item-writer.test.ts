/**
 * MULTI-COURSE Schedule Slice W-S3A - DB-free tests for the offering-scoped
 * view/edit writer (week metadata + week/item ownership) and its pure core.
 *
 * No Prisma, no DB: the offering resolver, the week/item owner readers and the
 * metadata commit are injected as fakes that RECORD their calls, so these tests
 * prove the whole boundary - gate ordering, the fail-closed ownership denials,
 * metadata payload shape, and metadata item-preservation - without a database.
 *
 * Run: npx tsx --test lib/course/offering-schedule-item-writer.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { CourseOfferingStatus } from "@/app/generated/prisma/client";
import {
  authorizeOfferingItemTargetWithDeps,
  authorizeOfferingWeekTargetWithDeps,
  updateOfferingWeekMetadataWithDeps,
  type ItemTargetDeps,
  type MetadataWriteDeps,
  type ResolvedOfferingForScheduleEdit,
  type WeekTargetDeps,
} from "./offering-schedule-item-writer";
import {
  buildWeekMetadataUpdateData,
  isItemOwnedByOffering,
  validateWeekMetadataInput,
  type ItemWeekOwnerRow,
} from "./offering-schedule-item-writer-core";
import type { WeekOwnerRow } from "./offering-weekly-schedule-writer-core";
import { CourseOfferingNotFoundError } from "./admin-course-context";

const OFFERING_ID = "cmrxk58vc0000lscnfm54bpze"; // Level 2 (PLANNED)
const OTHER_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0"; // Level 1 (ACTIVE)
const WEEK_ID = "week-l2-1";
const ITEM_ID = "item-1";

function resolver(opts: {
  status?: CourseOfferingStatus;
  resolveThrows?: unknown;
}): {
  resolveOffering: (id: string) => Promise<ResolvedOfferingForScheduleEdit>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    resolveOffering: async (id) => {
      calls.push(id);
      if (opts.resolveThrows !== undefined) throw opts.resolveThrows;
      return { id: OFFERING_ID, status: opts.status ?? "PLANNED" };
    },
  };
}

// ===========================================================================
// Pure core
// ===========================================================================

test("validateWeekMetadataInput: fixed order of stable codes", () => {
  assert.deepEqual(validateWeekMetadataInput({ name: "  ", startDate: "x", endDate: "y" }), {
    ok: false,
    error: "name_required",
  });
  assert.deepEqual(validateWeekMetadataInput({ name: "ok", startDate: "", endDate: "2026-01-01" }), {
    ok: false,
    error: "dates_required",
  });
  assert.deepEqual(
    validateWeekMetadataInput({ name: "ok", startDate: "26/07/2026", endDate: "2026-07-30" }),
    { ok: false, error: "invalid_date" },
  );
  assert.deepEqual(
    validateWeekMetadataInput({ name: "ok", startDate: "2026-02-30", endDate: "2026-07-30" }),
    { ok: false, error: "invalid_date" },
  );
  assert.deepEqual(
    validateWeekMetadataInput({ name: "ok", startDate: "2026-07-30", endDate: "2026-07-26" }),
    { ok: false, error: "end_before_start" },
  );
  const ok = validateWeekMetadataInput({ name: "  שבוע  ", startDate: "2026-07-26", endDate: "2026-07-30" });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { name: "שבוע", startDateKey: "2026-07-26", endDateKey: "2026-07-30" });
});

test("start === end is allowed (a single-day week)", () => {
  const r = validateWeekMetadataInput({ name: "x", startDate: "2026-07-26", endDate: "2026-07-26" });
  assert.ok(r.ok);
});

test("buildWeekMetadataUpdateData carries ONLY name/startDate/endDate", () => {
  const data = buildWeekMetadataUpdateData({
    name: "x",
    startDateKey: "2026-07-26",
    endDateKey: "2026-07-30",
  });
  assert.deepEqual(Object.keys(data).sort(), ["endDate", "name", "startDate"]);
  assert.equal("courseOfferingId" in data, false);
  assert.equal("isPublished" in data, false);
  assert.equal("items" in data, false);
});

test("isItemOwnedByOffering: item -> week -> offering, strict and fail-closed", () => {
  const owned: ItemWeekOwnerRow = { id: ITEM_ID, weeklyScheduleId: WEEK_ID, weekCourseOfferingId: OFFERING_ID };
  assert.equal(isItemOwnedByOffering(owned, OFFERING_ID), true);
  assert.equal(isItemOwnedByOffering(owned, OTHER_OFFERING_ID), false);
  assert.equal(isItemOwnedByOffering(null, OFFERING_ID), false);
  assert.equal(
    isItemOwnedByOffering({ id: ITEM_ID, weeklyScheduleId: WEEK_ID, weekCourseOfferingId: null }, OFFERING_ID),
    false,
  );
  assert.equal(
    isItemOwnedByOffering({ id: ITEM_ID, weeklyScheduleId: "", weekCourseOfferingId: OFFERING_ID }, OFFERING_ID),
    false,
  );
});

// ===========================================================================
// Week-target authorization (read gate / item create)
// ===========================================================================

function weekDeps(opts: {
  status?: CourseOfferingStatus;
  resolveThrows?: unknown;
  weekOwner?: WeekOwnerRow | null;
}): { deps: WeekTargetDeps; resolveCalls: string[]; fetchCalls: string[] } {
  const r = resolver(opts);
  const fetchCalls: string[] = [];
  return {
    resolveCalls: r.calls,
    fetchCalls,
    deps: {
      resolveOffering: r.resolveOffering,
      fetchWeekOwner: async (id) => {
        fetchCalls.push(id);
        return opts.weekOwner === undefined ? null : opts.weekOwner;
      },
    },
  };
}

test("own-offering week is authorized (readable / creatable)", async () => {
  const d = weekDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
  const result = await authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps);
  assert.deepEqual(result, { ok: true, weeklyScheduleId: WEEK_ID });
});

test("foreign-offering week -> week_not_found", async () => {
  const d = weekDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: OTHER_OFFERING_ID } });
  const result = await authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps);
  assert.deepEqual(result, { ok: false, error: "week_not_found" });
});

test("NULL-scoped legacy week -> week_not_found (never adopted)", async () => {
  const d = weekDeps({ weekOwner: { id: WEEK_ID, courseOfferingId: null } });
  const result = await authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps);
  assert.deepEqual(result, { ok: false, error: "week_not_found" });
});

test("missing week -> week_not_found", async () => {
  const d = weekDeps({ weekOwner: null });
  const result = await authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps);
  assert.deepEqual(result, { ok: false, error: "week_not_found" });
});

test("PLANNED offering permits draft configuration (Level 2 editable before ACTIVE)", async () => {
  const d = weekDeps({ status: "PLANNED", weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
  const result = await authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps);
  assert.equal(result.ok, true);
});

test("ARCHIVED offering denies mutation, with no week fetch", async () => {
  const d = weekDeps({ status: "ARCHIVED", weekOwner: { id: WEEK_ID, courseOfferingId: OFFERING_ID } });
  const result = await authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps);
  assert.deepEqual(result, { ok: false, error: "operation_not_allowed" });
  assert.deepEqual(d.fetchCalls, [], "policy is checked BEFORE the week is fetched");
});

test("unresolvable offering -> offering_not_found, with no week fetch", async () => {
  const d = weekDeps({ resolveThrows: new CourseOfferingNotFoundError("nope") });
  const result = await authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps);
  assert.deepEqual(result, { ok: false, error: "offering_not_found" });
  assert.deepEqual(d.fetchCalls, []);
});

test("a non-not-found resolver error propagates untouched", async () => {
  const d = weekDeps({ resolveThrows: new Error("db down") });
  await assert.rejects(() => authorizeOfferingWeekTargetWithDeps(OFFERING_ID, WEEK_ID, d.deps), /db down/);
});

// ===========================================================================
// Item-target authorization (item edit / delete)
// ===========================================================================

function itemDeps(opts: {
  status?: CourseOfferingStatus;
  itemOwner?: ItemWeekOwnerRow | null;
}): { deps: ItemTargetDeps; fetchCalls: string[] } {
  const r = resolver(opts);
  const fetchCalls: string[] = [];
  return {
    fetchCalls,
    deps: {
      resolveOffering: r.resolveOffering,
      fetchItemOwner: async (id) => {
        fetchCalls.push(id);
        return opts.itemOwner === undefined ? null : opts.itemOwner;
      },
    },
  };
}

test("item edit/delete: own item is authorized and returns its STORED week id", async () => {
  const d = itemDeps({ itemOwner: { id: ITEM_ID, weeklyScheduleId: WEEK_ID, weekCourseOfferingId: OFFERING_ID } });
  const result = await authorizeOfferingItemTargetWithDeps(OFFERING_ID, ITEM_ID, d.deps);
  assert.deepEqual(result, { ok: true, weeklyScheduleId: WEEK_ID });
});

test("item edit/delete: foreign item cannot be edited from this offering", async () => {
  const d = itemDeps({
    itemOwner: { id: ITEM_ID, weeklyScheduleId: "other-week", weekCourseOfferingId: OTHER_OFFERING_ID },
  });
  const result = await authorizeOfferingItemTargetWithDeps(OFFERING_ID, ITEM_ID, d.deps);
  assert.deepEqual(result, { ok: false, error: "week_not_found" });
});

test("item edit/delete: NULL-scoped and missing item both collapse to week_not_found", async () => {
  const nullScoped = itemDeps({
    itemOwner: { id: ITEM_ID, weeklyScheduleId: WEEK_ID, weekCourseOfferingId: null },
  });
  const missing = itemDeps({ itemOwner: null });
  const a = await authorizeOfferingItemTargetWithDeps(OFFERING_ID, ITEM_ID, nullScoped.deps);
  const b = await authorizeOfferingItemTargetWithDeps(OFFERING_ID, ITEM_ID, missing.deps);
  assert.deepEqual(a, { ok: false, error: "week_not_found" });
  assert.deepEqual(b, a, "both denials are indistinguishable");
});

test("item edit/delete: ARCHIVED denies before any item fetch", async () => {
  const d = itemDeps({ status: "ARCHIVED", itemOwner: { id: ITEM_ID, weeklyScheduleId: WEEK_ID, weekCourseOfferingId: OFFERING_ID } });
  const result = await authorizeOfferingItemTargetWithDeps(OFFERING_ID, ITEM_ID, d.deps);
  assert.deepEqual(result, { ok: false, error: "operation_not_allowed" });
  assert.deepEqual(d.fetchCalls, []);
});

// ===========================================================================
// Metadata update - items preserved, ownership never rewritten
// ===========================================================================

function metaDeps(opts: {
  status?: CourseOfferingStatus;
  commitCount?: number;
}): {
  deps: MetadataWriteDeps;
  commitCalls: Array<{ weeklyScheduleId: string; courseOfferingId: string; data: Record<string, unknown> }>;
} {
  const r = resolver(opts);
  const commitCalls: Array<{ weeklyScheduleId: string; courseOfferingId: string; data: Record<string, unknown> }> = [];
  return {
    commitCalls,
    deps: {
      resolveOffering: r.resolveOffering,
      commitMetadata: async ({ weeklyScheduleId, courseOfferingId, data }) => {
        commitCalls.push({ weeklyScheduleId, courseOfferingId, data: data as unknown as Record<string, unknown> });
        return opts.commitCount ?? 1;
      },
    },
  };
}

const META_INPUT = {
  courseOfferingId: OFFERING_ID,
  weeklyScheduleId: WEEK_ID,
  name: "שבוע א רמה 2 (מעודכן)",
  startDate: "2026-07-26",
  endDate: "2026-07-30",
};

test("metadata: invalid input never reaches resolve or commit", async () => {
  const d = metaDeps({});
  const result = await updateOfferingWeekMetadataWithDeps({ ...META_INPUT, name: "  " }, d.deps);
  assert.deepEqual(result, { success: false, error: "name_required" });
  assert.deepEqual(d.commitCalls, []);
});

test("metadata: end before start is rejected before commit", async () => {
  const d = metaDeps({});
  const result = await updateOfferingWeekMetadataWithDeps(
    { ...META_INPUT, startDate: "2026-07-30", endDate: "2026-07-26" },
    d.deps,
  );
  assert.deepEqual(result, { success: false, error: "end_before_start" });
  assert.deepEqual(d.commitCalls, []);
});

test("metadata: commit is scoped by BOTH id and courseOfferingId, data has 3 keys only", async () => {
  const d = metaDeps({ commitCount: 1 });
  const result = await updateOfferingWeekMetadataWithDeps(META_INPUT, d.deps);
  assert.deepEqual(result, { success: true, weeklyScheduleId: WEEK_ID });
  assert.equal(d.commitCalls.length, 1);
  const call = d.commitCalls[0];
  assert.equal(call.weeklyScheduleId, WEEK_ID);
  // The ownership scope is the SERVER-RESOLVED offering id, carried into the where.
  assert.equal(call.courseOfferingId, OFFERING_ID);
  assert.deepEqual(Object.keys(call.data).sort(), ["endDate", "name", "startDate"]);
  assert.equal("courseOfferingId" in call.data, false, "metadata data must not carry courseOfferingId");
  assert.equal("isPublished" in call.data, false, "metadata data must not carry isPublished");
  assert.equal("items" in call.data, false, "metadata data must not reference items");
});

test("metadata: a zero-row update (foreign/NULL/missing week) -> week_not_found", async () => {
  const d = metaDeps({ commitCount: 0 });
  const result = await updateOfferingWeekMetadataWithDeps(META_INPUT, d.deps);
  assert.deepEqual(result, { success: false, error: "week_not_found" });
});

test("metadata: a caller-supplied offering id never overrides the resolved scope", async () => {
  // The fake resolver always returns OFFERING_ID; the commit's where must use that
  // resolved id, never the raw input argument, so ownership cannot be retargeted.
  const d = metaDeps({ commitCount: 1 });
  await updateOfferingWeekMetadataWithDeps({ ...META_INPUT, courseOfferingId: OTHER_OFFERING_ID }, d.deps);
  assert.equal(d.commitCalls[0].courseOfferingId, OFFERING_ID);
});

test("metadata: ARCHIVED offering denies the edit before commit", async () => {
  const d = metaDeps({ status: "ARCHIVED" });
  const result = await updateOfferingWeekMetadataWithDeps(META_INPUT, d.deps);
  assert.deepEqual(result, { success: false, error: "operation_not_allowed" });
  assert.deepEqual(d.commitCalls, []);
});
