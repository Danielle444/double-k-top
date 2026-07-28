/**
 * P-MATERIALS M3B - focused tests for the authoritative material-notification
 * snapshot and its offering-scoped trainee recipient resolution.
 *
 * Everything here runs against injected fakes: no live Prisma, no Next.js
 * cookies, no session, no React, no network. They lock the M3B contract:
 *  - the persisted CourseMaterial is read EXACTLY ONCE and is authoritative for
 *    existence, isActive, visibility and title;
 *  - a caller's forged title/visibility can neither widen nor alter anything,
 *    because this layer never receives them;
 *  - the material's persisted audience is the OUTER boundary of the trainee set,
 *    resolved material -> audience -> offering -> enrollment -> trainee and never
 *    the other way round;
 *  - a Level-2-only trainee is never reachable by a Level-1-only material (and
 *    vice versa), while a dual-enrolled trainee collapses to exactly one id;
 *  - PLANNED/ARCHIVED offerings, disabled capabilities, inactive enrollments and
 *    inactive trainees each contribute nobody;
 *  - a malformed identifier refuses the whole fan-out with a PII-free error;
 *  - the module takes no recipient list, does no auth and mints no endpoint.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/capabilities/material-notification-trainee-recipients.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  loadMaterialNotificationSnapshotWithDeps,
  type AudienceOfferingRow,
  type MaterialNotificationSnapshotDeps,
  type PersistedMaterialRow,
  type TraineeEnrollmentRow,
} from "./material-notification-trainee-recipients";
import { MaterialNotificationIdError } from "./material-notification-recipient-core";

const MODULE_FILE = "material-notification-trainee-recipients.ts";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

// ---------------------------------------------------------------------------
// Fixtures + a recording dependency harness
// ---------------------------------------------------------------------------

const L1 = "offering-level-1";
const L2 = "offering-level-2";

function material(overrides: Partial<PersistedMaterialRow> = {}): PersistedMaterialRow {
  return {
    id: "material-1",
    title: "חוברת הקורס",
    visibility: "STUDENTS",
    isActive: true,
    audiences: [{ courseOfferingId: L1 }],
    ...overrides,
  };
}

interface Harness {
  deps: MaterialNotificationSnapshotDeps;
  calls: {
    loadMaterial: string[];
    loadOfferings: string[][];
    capability: string[];
    loadEnrollments: string[][];
  };
}

function harness(options: {
  material?: PersistedMaterialRow | null;
  offerings?: readonly AudienceOfferingRow[];
  enabled?: readonly string[];
  enrollments?: readonly TraineeEnrollmentRow[];
}): Harness {
  const calls: Harness["calls"] = {
    loadMaterial: [],
    loadOfferings: [],
    capability: [],
    loadEnrollments: [],
  };
  const enabled = new Set(options.enabled ?? [L1, L2]);
  return {
    calls,
    deps: {
      loadMaterial: async (id) => {
        calls.loadMaterial.push(id);
        return options.material === undefined ? material() : options.material;
      },
      loadOfferings: async (ids) => {
        calls.loadOfferings.push([...ids]);
        return (
          options.offerings ?? [
            { id: L1, status: "ACTIVE" },
            { id: L2, status: "ACTIVE" },
          ]
        ).filter((o) => ids.includes(o.id));
      },
      isMaterialsCapabilityEnabled: async (id) => {
        calls.capability.push(id);
        return enabled.has(id);
      },
      loadEnrollments: async (ids) => {
        calls.loadEnrollments.push([...ids]);
        return (options.enrollments ?? []).filter((e) => ids.includes(e.courseOfferingId));
      },
    },
  };
}

function enrollment(
  studentId: string,
  courseOfferingId: string,
  overrides: Partial<TraineeEnrollmentRow> = {},
): TraineeEnrollmentRow {
  return {
    studentId,
    courseOfferingId,
    status: "ACTIVE",
    student: { isActive: true },
    ...overrides,
  };
}

// ===========================================================================
// 1-2. The material row is authoritative for EXISTENCE and isActive
// ===========================================================================

test("1. a missing material yields null - no branch, no recipient, no further read", async () => {
  const h = harness({ material: null });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("ghost", h.deps);

  assert.equal(snapshot, null, "an unknown id must refuse the whole fan-out");
  assert.deepEqual(h.calls.loadOfferings, [], "no audience read for a non-existent material");
  assert.deepEqual(h.calls.capability, [], "no capability read");
  assert.deepEqual(h.calls.loadEnrollments, [], "no enrollment read");
});

test("2. an inactive material resolves no trainee recipients and reports isActive false", async () => {
  const h = harness({
    material: material({ isActive: false }),
    enrollments: [enrollment("trainee-1", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.ok(snapshot);
  assert.equal(snapshot.isActive, false, "the fan-out must be able to refuse on the persisted flag");
  assert.deepEqual(snapshot.traineeRecipientIds, [], "a hidden material notifies no trainee");
  assert.deepEqual(h.calls.capability, [], "the trainee gate short-circuits before any capability read");
});

// ===========================================================================
// 3-5. Persisted visibility drives the branches
// ===========================================================================

test("3. persisted INSTRUCTORS resolves zero trainee recipients (instructors only)", async () => {
  const h = harness({
    material: material({ visibility: "INSTRUCTORS" }),
    enrollments: [enrollment("trainee-1", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.equal(snapshot?.visibility, "INSTRUCTORS");
  assert.deepEqual(snapshot?.traineeRecipientIds, []);
  assert.deepEqual(h.calls.loadEnrollments, [], "no enrollment is even loaded");
});

test("4. persisted STUDENTS resolves trainee recipients", async () => {
  const h = harness({
    material: material({ visibility: "STUDENTS" }),
    enrollments: [enrollment("trainee-1", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.equal(snapshot?.visibility, "STUDENTS");
  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["trainee-1"]);
});

test("5. persisted BOTH resolves trainee recipients and reports BOTH for the instructor gate", async () => {
  const h = harness({
    material: material({ visibility: "BOTH" }),
    enrollments: [enrollment("trainee-1", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.equal(snapshot?.visibility, "BOTH");
  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["trainee-1"]);
});

test("5b. an unexpected persisted visibility fails CLOSED on the trainee side", async () => {
  for (const visibility of ["students", "ALL", "", "PUBLIC"]) {
    const h = harness({
      material: material({ visibility }),
      enrollments: [enrollment("trainee-1", L1)],
    });
    const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);
    assert.deepEqual(
      snapshot?.traineeRecipientIds,
      [],
      `visibility ${JSON.stringify(visibility)} must not open the trainee path`,
    );
  }
});

// ===========================================================================
// 6-7. Forged caller parameters cannot reach this layer at all
// ===========================================================================

test("6-7. the resolver's only input is a material id - no title, no visibility, no recipients", () => {
  const src = readSource(`./${MODULE_FILE}`);

  // Structural proof of the security correction: the exported entry points take
  // (materialId, deps) only. There is no parameter through which a caller could
  // supply a title, a visibility, an offering id or a recipient list.
  assert.match(
    src,
    /export async function loadMaterialNotificationSnapshotWithDeps\(\s*materialId: string,\s*deps: MaterialNotificationSnapshotDeps,\s*\)/,
    "the DI entry point must accept only a material id and its dependencies",
  );
  assert.match(
    src,
    /export async function loadMaterialNotificationSnapshot\(\s*materialId: string,\s*\)/,
    "the Prisma binding must accept only a material id",
  );
  for (const forbidden of ["recipientIds", "studentIds", "recipients:", "courseOfferingIds:"]) {
    assert.ok(!src.includes(forbidden), `no caller-supplied ${forbidden} may exist`);
  }
});

test("7b. the snapshot's title and visibility are the persisted row's, verbatim", async () => {
  const h = harness({
    material: material({ title: "שם אמיתי מהמסד", visibility: "BOTH" }),
    enrollments: [enrollment("trainee-1", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.equal(snapshot?.title, "שם אמיתי מהמסד");
  assert.equal(snapshot?.visibility, "BOTH");
  assert.equal(snapshot?.materialId, "material-1");
});

// ===========================================================================
// 8. Audience is the outer boundary - zero rows fail closed
// ===========================================================================

test("8. zero audience rows resolve zero trainee recipients, fail-closed", async () => {
  const h = harness({
    material: material({ audiences: [] }),
    enrollments: [enrollment("trainee-1", L1), enrollment("trainee-2", L2)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual(snapshot?.traineeRecipientIds, []);
  assert.deepEqual(h.calls.loadOfferings, [], "an unassigned material reads no offering");
  assert.deepEqual(h.calls.loadEnrollments, [], "and no enrollment");
});

test("8b. a blank or malformed audience id is ignored without inventing an offering", async () => {
  const h = harness({
    material: material({
      audiences: [
        { courseOfferingId: "  " },
        { courseOfferingId: L1 },
        { courseOfferingId: L1 },
      ] as PersistedMaterialRow["audiences"],
    }),
    enrollments: [enrollment("trainee-1", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual(h.calls.loadOfferings, [[L1]], "blank dropped, duplicate collapsed");
  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["trainee-1"]);
});

// ===========================================================================
// 9-11. Offering lifecycle + capability gating
// ===========================================================================

test("9. an ACTIVE offering with COURSE_MATERIALS ENABLED contributes its trainees", async () => {
  const h = harness({
    material: material({ audiences: [{ courseOfferingId: L1 }] }),
    offerings: [{ id: L1, status: "ACTIVE" }],
    enabled: [L1],
    enrollments: [enrollment("trainee-1", L1), enrollment("trainee-2", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["trainee-1", "trainee-2"]);
  assert.deepEqual(h.calls.loadEnrollments, [[L1]], "enrollments are loaded for eligible offerings only");
});

test("10. PLANNED and ARCHIVED audience offerings contribute nobody", async () => {
  for (const status of ["PLANNED", "ARCHIVED", "", "active"]) {
    const h = harness({
      material: material({ audiences: [{ courseOfferingId: L1 }] }),
      offerings: [{ id: L1, status }],
      enabled: [L1],
      enrollments: [enrollment("trainee-1", L1)],
    });
    const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

    assert.deepEqual(
      snapshot?.traineeRecipientIds,
      [],
      `offering status ${JSON.stringify(status)} must contribute nobody`,
    );
    assert.deepEqual(
      h.calls.capability,
      [],
      "a non-ACTIVE offering must not even cost a capability read",
    );
  }
});

test("11. an absent / DISABLED / READ_ONLY capability contributes nobody", async () => {
  // The shell only ever sees the committed reader's resolved boolean; every
  // non-ENABLED status arrives here as `false`.
  const h = harness({
    material: material({ audiences: [{ courseOfferingId: L1 }] }),
    offerings: [{ id: L1, status: "ACTIVE" }],
    enabled: [],
    enrollments: [enrollment("trainee-1", L1)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual(snapshot?.traineeRecipientIds, []);
  assert.deepEqual(h.calls.capability, [L1], "the capability was consulted and denied");
  assert.deepEqual(h.calls.loadEnrollments, [], "no enrollment read once nothing is eligible");
});

// ===========================================================================
// 12-14. Level 1 / Level 2 / dual-course
// ===========================================================================

test("12. an L1-audience material never reaches a Level-2-only trainee", async () => {
  const h = harness({
    material: material({ audiences: [{ courseOfferingId: L1 }] }),
    offerings: [
      { id: L1, status: "ACTIVE" },
      { id: L2, status: "ACTIVE" },
    ],
    enabled: [L1, L2],
    enrollments: [enrollment("l1-only", L1), enrollment("l2-only", L2)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["l1-only"]);
  assert.ok(!snapshot?.traineeRecipientIds.includes("l2-only"), "the L2-only trainee is excluded");
});

test("13. an L2-audience material never reaches a Level-1-only trainee", async () => {
  const h = harness({
    material: material({ audiences: [{ courseOfferingId: L2 }] }),
    offerings: [
      { id: L1, status: "ACTIVE" },
      { id: L2, status: "ACTIVE" },
    ],
    enabled: [L1, L2],
    enrollments: [enrollment("l1-only", L1), enrollment("l2-only", L2)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["l2-only"]);
});

test("13b. an L2 audience contributes nobody while Level 2 has no ENABLED capability", async () => {
  // The expected production posture at rollout: the L2 offering is ACTIVE but its
  // COURSE_MATERIALS capability row is absent, so the slice is inert for Level 2.
  const h = harness({
    material: material({ audiences: [{ courseOfferingId: L2 }] }),
    offerings: [{ id: L2, status: "ACTIVE" }],
    enabled: [L1],
    enrollments: [enrollment("l2-only", L2)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual(snapshot?.traineeRecipientIds, []);
});

test("14. a dual-enrolled trainee matching BOTH audience offerings is deduplicated to one", async () => {
  const h = harness({
    material: material({
      audiences: [{ courseOfferingId: L1 }, { courseOfferingId: L2 }],
    }),
    offerings: [
      { id: L1, status: "ACTIVE" },
      { id: L2, status: "ACTIVE" },
    ],
    enabled: [L1, L2],
    enrollments: [
      enrollment("dual", L1),
      enrollment("dual", L2),
      enrollment("l1-only", L1),
    ],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["dual", "l1-only"]);
  assert.equal(
    snapshot?.traineeRecipientIds.filter((id) => id === "dual").length,
    1,
    "one notification per trainee, never one per matching offering",
  );
});

test("14b. a dual-enrolled trainee is notified once via the single eligible offering", async () => {
  const h = harness({
    material: material({
      audiences: [{ courseOfferingId: L1 }, { courseOfferingId: L2 }],
    }),
    offerings: [
      { id: L1, status: "ACTIVE" },
      { id: L2, status: "PLANNED" },
    ],
    enabled: [L1, L2],
    enrollments: [enrollment("dual", L1), enrollment("dual", L2)],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["dual"]);
  assert.deepEqual(h.calls.loadEnrollments, [[L1]], "only the eligible offering is queried");
});

// ===========================================================================
// 15-16. Enrollment + trainee lifecycle
// ===========================================================================

test("15. an INACTIVE enrollment is excluded", async () => {
  const h = harness({
    enrollments: [
      enrollment("active-one", L1),
      enrollment("inactive-enrollment", L1, { status: "INACTIVE" }),
    ],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["active-one"]);
});

test("16. an inactive (or missing) trainee is excluded", async () => {
  const h = harness({
    enrollments: [
      enrollment("active-one", L1),
      enrollment("inactive-trainee", L1, { student: { isActive: false } }),
      enrollment("orphan", L1, { student: null }),
    ],
  });
  const snapshot = await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual([...(snapshot?.traineeRecipientIds ?? [])], ["active-one"]);
});

// ===========================================================================
// 17. Malformed identifiers refuse the whole fan-out, PII-free
// ===========================================================================

test("17. a blank/non-string resolved trainee id refuses the fan-out without leaking PII", async () => {
  const h = harness({
    enrollments: [
      enrollment("good", L1),
      enrollment("", L1),
    ],
  });

  await assert.rejects(
    () => loadMaterialNotificationSnapshotWithDeps("material-1", h.deps),
    (error: unknown) => {
      assert.ok(error instanceof MaterialNotificationIdError, "the typed refusal must propagate");
      assert.equal(error.field, "studentId");
      assert.equal(error.index, 1);
      // PII-free: neither the offending value nor a neighbouring id appears.
      assert.ok(!error.message.includes("good"), "no neighbouring identifier in the message");
      assert.ok(!error.message.includes(L1), "no offering id in the message");
      return true;
    },
    "a malformed identifier must refuse the whole send, never send partially",
  );
});

// ===========================================================================
// 18. Capability evaluation is bounded: at most once per distinct offering
// ===========================================================================

test("18. the capability is resolved at most once per distinct ACTIVE audience offering", async () => {
  const h = harness({
    material: material({
      audiences: [
        { courseOfferingId: L1 },
        { courseOfferingId: L2 },
        { courseOfferingId: L1 },
      ],
    }),
    offerings: [
      { id: L1, status: "ACTIVE" },
      { id: L2, status: "ACTIVE" },
    ],
    enabled: [L1, L2],
    enrollments: [enrollment("trainee-1", L1)],
  });
  await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual(h.calls.capability, [L1, L2], "exactly one resolution per distinct offering");
  assert.equal(new Set(h.calls.capability).size, h.calls.capability.length, "no repeated resolution");
});

test("18b. the CourseMaterial is read EXACTLY once per fan-out", async () => {
  const h = harness({
    material: material({
      audiences: [{ courseOfferingId: L1 }, { courseOfferingId: L2 }],
    }),
    enrollments: [enrollment("dual", L1), enrollment("dual", L2)],
  });
  await loadMaterialNotificationSnapshotWithDeps("material-1", h.deps);

  assert.deepEqual(h.calls.loadMaterial, ["material-1"], "one read, shared by both branches");
});

// ===========================================================================
// Structural containment
// ===========================================================================

test("the shell mints no endpoint, performs no auth and imports no lib/actions runtime value", () => {
  const src = readSource(`./${MODULE_FILE}`);

  assert.ok(
    !/^\s*["']use server["']\s*;?\s*$/m.test(src),
    "the shell must not declare 'use server'",
  );
  for (const marker of [
    "requireAdmin",
    "getServerSession",
    "next-auth",
    "adminEmail",
    "cookies(",
    "next/headers",
    "getCurrentTrainee",
    "getCurrentInstructor",
  ]) {
    assert.ok(!src.includes(marker), `the shell must not perform auth/session work ("${marker}")`);
  }
  const valueActionImports = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s*["'](@\/lib\/actions\/[^"']+)["']/gm),
  ];
  assert.deepEqual(
    valueActionImports.map((m) => m[1]),
    [],
    "no VALUE import from a 'use server' module",
  );
});

test("the shell reads the audience through the relation, never the audience delegate", () => {
  const src = readSource(`./${MODULE_FILE}`).toLowerCase();
  // Direct Prisma access to that table is confined by contract to the M2B write
  // module; this shell must read it as a nested relation instead.
  assert.ok(!src.includes("prisma.coursematerialaudience"), "no audience delegate access");
  assert.ok(!src.includes("course_material_audiences"), "no audience table name");
  assert.ok(
    readSource(`./${MODULE_FILE}`).includes("audiences: { select: { courseOfferingId: true } }"),
    "the audience must be read through the CourseMaterial.audiences relation",
  );
});

test("the shell resolves material -> audience -> trainees, never the reverse", () => {
  const src = readSource(`./${MODULE_FILE}`);

  // A global student query is exactly the widening this slice removes, and a
  // trainee-first resolution is how a dual-enrolled trainee leaks across courses.
  assert.ok(!src.includes("prisma.student.findMany"), "no global student fan-out");
  assert.ok(
    !/courseEnrollment\.findMany\(\{\s*where:\s*\{\s*studentId/.test(src),
    "enrollments must be queried by offering, never by trainee",
  );
  assert.ok(
    src.includes("where: { courseOfferingId: { in: [...offeringIds] } }"),
    "the enrollment query is scoped by the eligible audience offerings",
  );
  // No course-scope inference of any kind may substitute for the persisted audience.
  for (const forbidden of ["groupName", "subgroupNumber", "level", "activityYear", "startDate"]) {
    assert.ok(!src.includes(forbidden), `no course-scope inference via ${forbidden}`);
  }
});

test("the capability key is imported, not re-spelled, and evaluation is not restated", () => {
  const src = readSource(`./${MODULE_FILE}`);

  assert.ok(
    src.includes("MATERIAL_NOTIFICATION_CAPABILITY_KEY"),
    "the shell must use the core's canonical key constant",
  );
  assert.ok(
    !/\bCOURSE_MATERIALS\b/.test(src),
    "the key literal must live in exactly one place - re-spelling it invites drift",
  );
  // The one sanctioned capability comparison is against the committed reader's
  // output. No status lattice may be re-implemented here.
  assert.ok(src.includes("getEffectiveCapabilities"), "the committed reader must be consumed");
  for (const forbidden of ["READ_ONLY", "resolveEffectiveCapabilitiesFromRows", "dependsOn", "defaultEnabled"]) {
    assert.ok(!src.includes(forbidden), `capability evaluation must not be restated (${forbidden})`);
  }
});

test("every recipient decision is delegated to the committed pure core", () => {
  const src = readSource(`./${MODULE_FILE}`);
  for (const required of [
    "shouldMaterialNotifyTrainees",
    "resolveEligibleMaterialNotificationOfferingIds",
    "resolveMaterialNotificationRecipientIds",
  ]) {
    assert.ok(src.includes(required), `the shell must delegate to ${required}`);
  }
});

test("no push, message/task or attendance surface is reachable from this slice", () => {
  const src = readSource(`./${MODULE_FILE}`);
  for (const forbidden of [
    "webpush",
    "web-push",
    "sendNewMessagePush",
    "pushSubscription",
    "messageTask",
    "ATTENDANCE_MARKED",
    "syncAttendanceMarkedNotification",
  ]) {
    assert.ok(!src.includes(forbidden), `M3B must not touch ${forbidden}`);
  }
});
