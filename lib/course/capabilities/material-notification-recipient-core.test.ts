/**
 * SECURITY / LEVEL 2 SLICE L2-MATERIAL-NOTIFY-1 - focused tests for the PURE
 * material-notification recipient core.
 *
 * Everything here runs against plain values: no Next.js cookies, no live Prisma,
 * no React, no network. They lock the L2-MATERIAL-NOTIFY-1 contract:
 *  - the trainee path is entered on a POSITIVE visibility allow-list only, so
 *    every malformed value fails closed;
 *  - duplicate offering ids and duplicate trainee ids collapse deterministically,
 *    so one material can never produce two notifications for one trainee;
 *  - a blank or non-string identifier REFUSES the whole fan-out and is never
 *    silently skipped, coerced or repaired;
 *  - a refusal carries only a code-owned field name and a positional index -
 *    never the offending value, never a neighbouring id, never any PII;
 *  - the module is genuinely pure (no runtime import at all) and does not restate
 *    any part of effective-capability evaluation;
 *  - exactly ONE production module (the P-MATERIALS M3B IO shell,
 *    ./material-notification-trainee-recipients.ts) consumes it, so there is no
 *    second recipient-resolution path able to drift from this one.
 *
 * Uses the existing `tsx` + node:test approach. Run with:
 *   npx tsx --test lib/course/capabilities/material-notification-recipient-core.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  MATERIAL_NOTIFICATION_CAPABILITY_KEY,
  MaterialNotificationIdError,
  dedupeMaterialNotificationOfferingIds,
  dedupeMaterialNotificationRecipientIds,
  resolveEligibleMaterialNotificationOfferingIds,
  resolveMaterialNotificationRecipientIds,
  resolveNewlyEligibleMaterialNotificationRecipientIds,
  shouldMaterialNotifyTrainees,
  shouldNotifyTrainees,
  type MaterialNotificationEnrollmentRow,
  type MaterialNotificationOfferingRow,
} from "./material-notification-recipient-core";
import { isCapabilityKey } from "./capability-keys";

// The two REAL production offering ids, so the Level 1 / Level 2 cases below
// describe the actual launch state rather than invented placeholders.
const LEVEL_1_OFFERING_ID = "cmrqngqhn00017gcndjixzrh0";
const LEVEL_2_OFFERING_ID = "cmrxk58vc0000lscnfm54bpze";

// ---------------------------------------------------------------------------
// M3A fixtures - a small, explicit roster reused across the cases below.
//
// Deliberately NOT derived from level, name, date or any other course-scope
// signal: every row states its offering id and its already-resolved booleans
// outright, which is exactly the contract the core is allowed to consume.
// ---------------------------------------------------------------------------

const LEVEL_1_ONLY_TRAINEE = "trainee-level-1-only";
const LEVEL_2_ONLY_TRAINEE = "trainee-level-2-only";
const DUAL_TRAINEE = "trainee-dual-enrolled";

/** Both flags on: the offering may notify. */
function liveOffering(courseOfferingId: string): MaterialNotificationOfferingRow {
  return { courseOfferingId, offeringActive: true, materialsCapabilityEnabled: true };
}

/** A live enrollment of a live trainee into one offering. */
function liveEnrollment(
  studentId: string,
  courseOfferingId: string,
): MaterialNotificationEnrollmentRow {
  return { studentId, courseOfferingId, enrollmentActive: true, traineeActive: true };
}

/**
 * The launch roster: one Level-1-only trainee, one Level-2-only trainee, and a
 * dual-enrolled trainee holding a live enrollment in BOTH offerings.
 */
const ROSTER: MaterialNotificationEnrollmentRow[] = [
  liveEnrollment(LEVEL_1_ONLY_TRAINEE, LEVEL_1_OFFERING_ID),
  liveEnrollment(DUAL_TRAINEE, LEVEL_1_OFFERING_ID),
  liveEnrollment(LEVEL_2_ONLY_TRAINEE, LEVEL_2_OFFERING_ID),
  liveEnrollment(DUAL_TRAINEE, LEVEL_2_OFFERING_ID),
];

/** Resolve recipients for an audience given as raw offering rows. */
function recipientsFor(
  audience: MaterialNotificationOfferingRow[],
  roster: MaterialNotificationEnrollmentRow[] = ROSTER,
): readonly string[] {
  return resolveMaterialNotificationRecipientIds(
    roster,
    resolveEligibleMaterialNotificationOfferingIds(audience),
  );
}

/** Every value that is truthy but is NOT the boolean `true`. */
const TRUTHY_NON_BOOLEANS: unknown[] = [
  1,
  -1,
  "true",
  "TRUE",
  "ENABLED",
  "ACTIVE",
  "yes",
  [],
  [true],
  {},
  { valueOf: () => true },
  new Boolean(true),
  Infinity,
  () => true,
];

const MODULE_FILE = "material-notification-recipient-core.ts";
const TEST_FILE = "material-notification-recipient-core.test.ts";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Source with block and line comments removed.
 *
 * The forbidden-identifier assertions below must test what the module actually
 * DOES, not what its documentation is allowed to mention: the core explains at
 * length WHY it refuses to restate capability evaluation, and naming those
 * concepts in prose must not be mistaken for implementing them. A real reference
 * in code still fails these checks.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** Narrow a caught value to the typed refusal, failing the test if it is not one. */
function asIdError(error: unknown): MaterialNotificationIdError {
  assert.ok(
    error instanceof MaterialNotificationIdError,
    "a malformed identifier must throw the typed refusal",
  );
  return error as MaterialNotificationIdError;
}

// ---------------------------------------------------------------------------
// Capability key
// ---------------------------------------------------------------------------

test("the notification capability key is the canonical materials key", () => {
  assert.equal(MATERIAL_NOTIFICATION_CAPABILITY_KEY, "COURSE_MATERIALS");
  // It must be a REAL canonical key, not a free-text string that merely looks
  // like one - an unknown key would grant nothing and fail silently.
  assert.equal(isCapabilityKey(MATERIAL_NOTIFICATION_CAPABILITY_KEY), true);
});

// ---------------------------------------------------------------------------
// Visibility predicate
// ---------------------------------------------------------------------------

test("STUDENTS and BOTH enter the trainee path", () => {
  assert.equal(shouldNotifyTrainees("STUDENTS"), true);
  assert.equal(shouldNotifyTrainees("BOTH"), true);
});

test("INSTRUCTORS does not enter the trainee path", () => {
  assert.equal(shouldNotifyTrainees("INSTRUCTORS"), false);
});

test("every malformed visibility fails closed", () => {
  const malformed: unknown[] = [
    undefined,
    null,
    "",
    " ",
    "students", // casing variant
    "Both",
    " STUDENTS", // untrimmed - deliberately NOT accepted
    "STUDENTS ",
    "ALL",
    "TRAINEES",
    "STUDENT",
    0,
    1,
    true,
    false,
    NaN,
    [],
    ["STUDENTS"],
    {},
    { visibility: "STUDENTS" },
    new String("STUDENTS"), // boxed string is not the primitive
    Symbol("STUDENTS"),
    () => "STUDENTS",
  ];
  for (const value of malformed) {
    assert.equal(
      shouldNotifyTrainees(value),
      false,
      `malformed visibility ${String(typeof value)} must fail closed`,
    );
  }
});

test("the visibility predicate is a positive allow-list, not a negated INSTRUCTORS test", () => {
  const code = readCode(`./${MODULE_FILE}`);
  assert.ok(
    !/!==\s*["']INSTRUCTORS["']/.test(code),
    "the trainee path must never be opened by excluding INSTRUCTORS",
  );
  assert.ok(
    code.includes('visibility === "STUDENTS"') && code.includes('visibility === "BOTH"'),
    "the trainee path must be opened by an explicit positive allow-list",
  );
});

// ---------------------------------------------------------------------------
// Offering-id deduplication
// ---------------------------------------------------------------------------

test("duplicate offering ids collapse deterministically in first-seen order", () => {
  const rows = [
    { courseOfferingId: LEVEL_2_OFFERING_ID },
    { courseOfferingId: LEVEL_1_OFFERING_ID },
    { courseOfferingId: LEVEL_2_OFFERING_ID },
    { courseOfferingId: LEVEL_1_OFFERING_ID },
    { courseOfferingId: LEVEL_2_OFFERING_ID },
  ];
  const first = dedupeMaterialNotificationOfferingIds(rows);

  // First-seen order, NOT sorted: the input order is the caller's (database)
  // order and must be preserved verbatim.
  assert.deepEqual(first, [LEVEL_2_OFFERING_ID, LEVEL_1_OFFERING_ID]);

  // Deterministic: identical input always produces identical output.
  assert.deepEqual(dedupeMaterialNotificationOfferingIds(rows), first);

  assert.deepEqual(dedupeMaterialNotificationOfferingIds([]), []);
  assert.deepEqual(dedupeMaterialNotificationOfferingIds([{ courseOfferingId: LEVEL_1_OFFERING_ID }]), [
    LEVEL_1_OFFERING_ID,
  ]);
});

test("a blank or non-string offering id throws instead of being skipped", () => {
  const invalid: unknown[] = [
    { courseOfferingId: "" },
    { courseOfferingId: "   " },
    { courseOfferingId: null },
    { courseOfferingId: undefined },
    { courseOfferingId: 42 },
    { courseOfferingId: {} },
    { courseOfferingId: [] },
    { courseOfferingId: [LEVEL_1_OFFERING_ID] },
    { courseOfferingId: new String(LEVEL_1_OFFERING_ID) },
    {}, // property entirely absent
    null,
    undefined,
  ];
  for (const row of invalid) {
    assert.throws(
      () =>
        dedupeMaterialNotificationOfferingIds([row] as unknown as { courseOfferingId: string }[]),
      MaterialNotificationIdError,
    );
  }
});

// ---------------------------------------------------------------------------
// Recipient-id deduplication
// ---------------------------------------------------------------------------

test("duplicate student ids collapse deterministically in first-seen order", () => {
  // The real reason this matters: one trainee holding ACTIVE enrollments in two
  // enabled offerings appears twice in the roster query, and Notification has no
  // uniqueness constraint - without dedupe they would receive the same material
  // notification twice.
  const rows = [
    { studentId: "student-b" },
    { studentId: "student-a" },
    { studentId: "student-b" },
    { studentId: "student-c" },
    { studentId: "student-a" },
  ];
  const first = dedupeMaterialNotificationRecipientIds(rows);

  assert.deepEqual(first, ["student-b", "student-a", "student-c"]);
  assert.deepEqual(dedupeMaterialNotificationRecipientIds(rows), first);

  assert.deepEqual(dedupeMaterialNotificationRecipientIds([]), []);
});

test("a blank or non-string student id throws instead of being skipped", () => {
  const invalid: unknown[] = [
    { studentId: "" },
    { studentId: "\t\n " },
    { studentId: null },
    { studentId: undefined },
    { studentId: 0 },
    { studentId: 123 },
    { studentId: true },
    { studentId: {} },
    { studentId: [] },
    { studentId: new String("student-a") },
    {},
    null,
    undefined,
  ];
  for (const row of invalid) {
    assert.throws(
      () => dedupeMaterialNotificationRecipientIds([row] as unknown as { studentId: string }[]),
      MaterialNotificationIdError,
    );
  }
});

test("one malformed id refuses the WHOLE fan-out - valid neighbours are not returned", () => {
  // A partial send is indistinguishable from a complete one, so the only safe
  // outcome is a refusal. Nothing is returned and nothing is silently dropped.
  assert.throws(
    () =>
      dedupeMaterialNotificationRecipientIds([
        { studentId: "student-a" },
        { studentId: "" },
        { studentId: "student-b" },
      ] as unknown as { studentId: string }[]),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "studentId");
      assert.equal(refusal.index, 1);
      return true;
    },
  );

  assert.throws(
    () =>
      dedupeMaterialNotificationOfferingIds([
        { courseOfferingId: LEVEL_1_OFFERING_ID },
        { courseOfferingId: LEVEL_2_OFFERING_ID },
        { courseOfferingId: null },
      ] as unknown as { courseOfferingId: string }[]),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "courseOfferingId");
      assert.equal(refusal.index, 2);
      return true;
    },
  );
});

test("identifiers are never trimmed, normalized, or otherwise rewritten", () => {
  // `trim()` exists ONLY as an emptiness TEST. A whitespace-padded id that is
  // otherwise usable must come back byte-for-byte as supplied, so two distinct
  // database ids can never be folded into one.
  const padded = ` ${LEVEL_1_OFFERING_ID} `;
  assert.deepEqual(dedupeMaterialNotificationOfferingIds([{ courseOfferingId: padded }]), [padded]);
  assert.deepEqual(
    dedupeMaterialNotificationOfferingIds([
      { courseOfferingId: padded },
      { courseOfferingId: LEVEL_1_OFFERING_ID },
    ]),
    [padded, LEVEL_1_OFFERING_ID],
  );

  const mixedCase = "Student-A";
  assert.deepEqual(
    dedupeMaterialNotificationRecipientIds([
      { studentId: mixedCase },
      { studentId: "student-a" },
    ]),
    [mixedCase, "student-a"],
  );
});

// ---------------------------------------------------------------------------
// Refusals are PII-free
// ---------------------------------------------------------------------------

test("a refusal never discloses the offending value, a neighbour, or any PII", () => {
  const PII = {
    fullName: "שרה כהן",
    phone: "0501234567",
    identityNumber: "123456789",
    title: "חוברת הקורס - שלב א",
  };

  const cases: { run: () => unknown; secrets: string[] }[] = [
    {
      // The malformed value itself is a whole PII-bearing object.
      run: () =>
        dedupeMaterialNotificationRecipientIds([
          { studentId: PII },
        ] as unknown as { studentId: string }[]),
      secrets: [PII.fullName, PII.phone, PII.identityNumber],
    },
    {
      // A VALID neighbouring id must not be echoed either.
      run: () =>
        dedupeMaterialNotificationOfferingIds([
          { courseOfferingId: LEVEL_1_OFFERING_ID },
          { courseOfferingId: PII.title },
          { courseOfferingId: "" },
        ] as unknown as { courseOfferingId: string }[]),
      secrets: [LEVEL_1_OFFERING_ID, PII.title],
    },
  ];

  for (const { run, secrets } of cases) {
    assert.throws(run, (error: unknown) => {
      const refusal = asIdError(error);
      const own = refusal as unknown as Record<string, unknown>;

      // Everything a logger could plausibly reach: the message, the string form,
      // the enumerable own properties, and the full own-property dump including
      // the non-enumerable ones (message/stack).
      const surfaces = [
        refusal.message,
        String(refusal),
        JSON.stringify(refusal),
        JSON.stringify(Object.getOwnPropertyNames(refusal).map((key) => own[key])),
      ].join("\n");

      for (const secret of secrets) {
        assert.ok(
          !surfaces.includes(secret),
          `refusal surface must not disclose ${JSON.stringify(secret)}`,
        );
      }

      // What it MAY carry: a code-owned field name and a positional index.
      assert.ok(["courseOfferingId", "studentId"].includes(refusal.field));
      assert.equal(typeof refusal.index, "number");
      assert.equal(refusal.name, "MaterialNotificationIdError");
      assert.ok(refusal instanceof Error);
      return true;
    });
  }
});

// ===========================================================================
// M3A - the material gate
// ===========================================================================

test("the material gate requires a live material AND a trainee-facing visibility", () => {
  assert.equal(shouldMaterialNotifyTrainees(true, "STUDENTS"), true);
  assert.equal(shouldMaterialNotifyTrainees(true, "BOTH"), true);

  // A live but instructor-only material never notifies trainees.
  assert.equal(shouldMaterialNotifyTrainees(true, "INSTRUCTORS"), false);
  // A hidden (soft-deleted) material never notifies, whatever its visibility.
  assert.equal(shouldMaterialNotifyTrainees(false, "STUDENTS"), false);
  assert.equal(shouldMaterialNotifyTrainees(false, "BOTH"), false);
  assert.equal(shouldMaterialNotifyTrainees(false, "INSTRUCTORS"), false);
});

test("the material gate fails closed on every malformed live-flag and visibility", () => {
  for (const value of TRUTHY_NON_BOOLEANS) {
    assert.equal(
      shouldMaterialNotifyTrainees(value, "STUDENTS"),
      false,
      "a truthy non-boolean live flag must not open the trainee path",
    );
  }
  for (const value of [undefined, null, "", 0, NaN, "ACTIVE", "true"]) {
    assert.equal(shouldMaterialNotifyTrainees(value, "BOTH"), false);
  }
  // The visibility half is DELEGATED, so it inherits the allow-list's strictness.
  for (const value of [undefined, null, "", "students", " STUDENTS", "ALL", 1, {}, []]) {
    assert.equal(shouldMaterialNotifyTrainees(true, value), false);
  }
});

test("the material gate delegates its visibility half rather than restating it", () => {
  // Every visibility that the gate accepts must be exactly a visibility the
  // shared allow-list accepts - no wider, no narrower. A second predicate here
  // could silently drift from the one the reader uses.
  const probes: unknown[] = [
    "STUDENTS",
    "BOTH",
    "INSTRUCTORS",
    "students",
    "Both",
    " STUDENTS",
    "",
    null,
    undefined,
    0,
    1,
    [],
    {},
  ];
  for (const value of probes) {
    assert.equal(
      shouldMaterialNotifyTrainees(true, value),
      shouldNotifyTrainees(value),
      `the gate and the allow-list must agree on ${JSON.stringify(String(value))}`,
    );
  }
});

// ===========================================================================
// M3A - eligible offerings
// ===========================================================================

test("an offering qualifies only when it is live AND its capability is on", () => {
  const eligible = resolveEligibleMaterialNotificationOfferingIds([
    liveOffering(LEVEL_1_OFFERING_ID),
    liveOffering(LEVEL_2_OFFERING_ID),
  ]);
  assert.deepEqual(eligible, [LEVEL_1_OFFERING_ID, LEVEL_2_OFFERING_ID]);

  // A not-live offering is excluded even with the capability on.
  assert.deepEqual(
    resolveEligibleMaterialNotificationOfferingIds([
      { courseOfferingId: LEVEL_1_OFFERING_ID, offeringActive: false, materialsCapabilityEnabled: true },
      liveOffering(LEVEL_2_OFFERING_ID),
    ]),
    [LEVEL_2_OFFERING_ID],
  );

  // A live offering whose capability is off is excluded too.
  assert.deepEqual(
    resolveEligibleMaterialNotificationOfferingIds([
      liveOffering(LEVEL_1_OFFERING_ID),
      { courseOfferingId: LEVEL_2_OFFERING_ID, offeringActive: true, materialsCapabilityEnabled: false },
    ]),
    [LEVEL_1_OFFERING_ID],
  );

  // Neither flag on.
  assert.deepEqual(
    resolveEligibleMaterialNotificationOfferingIds([
      { courseOfferingId: LEVEL_1_OFFERING_ID, offeringActive: false, materialsCapabilityEnabled: false },
    ]),
    [],
  );
});

test("a truthy non-boolean never qualifies an offering", () => {
  for (const value of TRUTHY_NON_BOOLEANS) {
    assert.deepEqual(
      resolveEligibleMaterialNotificationOfferingIds([
        {
          courseOfferingId: LEVEL_1_OFFERING_ID,
          offeringActive: value,
          materialsCapabilityEnabled: true,
        } as unknown as MaterialNotificationOfferingRow,
      ]),
      [],
      "the upstream verdict must arrive as a real boolean",
    );
    assert.deepEqual(
      resolveEligibleMaterialNotificationOfferingIds([
        {
          courseOfferingId: LEVEL_1_OFFERING_ID,
          offeringActive: true,
          materialsCapabilityEnabled: value,
        } as unknown as MaterialNotificationOfferingRow,
      ]),
      [],
    );
  }
});

test("a missing flag excludes the offering rather than defaulting it on", () => {
  assert.deepEqual(
    resolveEligibleMaterialNotificationOfferingIds([
      { courseOfferingId: LEVEL_1_OFFERING_ID } as unknown as MaterialNotificationOfferingRow,
    ]),
    [],
  );
});

test("duplicate eligible offerings collapse in first-seen order", () => {
  assert.deepEqual(
    resolveEligibleMaterialNotificationOfferingIds([
      liveOffering(LEVEL_2_OFFERING_ID),
      liveOffering(LEVEL_1_OFFERING_ID),
      liveOffering(LEVEL_2_OFFERING_ID),
    ]),
    [LEVEL_2_OFFERING_ID, LEVEL_1_OFFERING_ID],
  );
});

test("an empty or absent audience yields no eligible offering", () => {
  assert.deepEqual(resolveEligibleMaterialNotificationOfferingIds([]), []);
  for (const absent of [undefined, null, "", 0, {}]) {
    assert.deepEqual(
      resolveEligibleMaterialNotificationOfferingIds(
        absent as unknown as MaterialNotificationOfferingRow[],
      ),
      [],
      "an absent list carries no ids to be wrong about - it notifies nobody",
    );
  }
});

test("a malformed offering id throws even when its own row would be excluded", () => {
  // The row below is excluded by its flags, but a blank id is a data defect
  // wherever it sits and must never pass unnoticed.
  assert.throws(
    () =>
      resolveEligibleMaterialNotificationOfferingIds([
        liveOffering(LEVEL_1_OFFERING_ID),
        {
          courseOfferingId: "",
          offeringActive: false,
          materialsCapabilityEnabled: false,
        } as unknown as MaterialNotificationOfferingRow,
      ]),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "courseOfferingId");
      assert.equal(refusal.index, 1, "the index is the position in the supplied array");
      return true;
    },
  );

  for (const bad of ["", "   ", null, undefined, 42, {}, []]) {
    assert.throws(
      () =>
        resolveEligibleMaterialNotificationOfferingIds([
          {
            courseOfferingId: bad,
            offeringActive: true,
            materialsCapabilityEnabled: true,
          } as unknown as MaterialNotificationOfferingRow,
        ]),
      MaterialNotificationIdError,
    );
  }
});

// ===========================================================================
// M3A - recipients (the Level 1 / Level 2 / shared audience matrix)
// ===========================================================================

test("a Level-1-only audience notifies only Level-1 trainees", () => {
  const recipients = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)]);
  assert.deepEqual(recipients, [LEVEL_1_ONLY_TRAINEE, DUAL_TRAINEE]);
  assert.ok(
    !recipients.includes(LEVEL_2_ONLY_TRAINEE),
    "a Level-1 material must never reach a Level-2-only trainee",
  );
});

test("a Level-2-only audience notifies only Level-2 trainees", () => {
  const recipients = recipientsFor([liveOffering(LEVEL_2_OFFERING_ID)]);
  assert.deepEqual(recipients, [LEVEL_2_ONLY_TRAINEE, DUAL_TRAINEE]);
  assert.ok(
    !recipients.includes(LEVEL_1_ONLY_TRAINEE),
    "a Level-2 material must never reach a Level-1-only trainee",
  );
});

test("a shared audience notifies the union - and the dual trainee EXACTLY ONCE", () => {
  const recipients = recipientsFor([
    liveOffering(LEVEL_1_OFFERING_ID),
    liveOffering(LEVEL_2_OFFERING_ID),
  ]);
  assert.deepEqual(recipients, [LEVEL_1_ONLY_TRAINEE, DUAL_TRAINEE, LEVEL_2_ONLY_TRAINEE]);

  // The whole reason the dedupe exists: the dual trainee matches through BOTH
  // offerings, and Notification has no uniqueness constraint to save us.
  assert.equal(
    recipients.filter((id) => id === DUAL_TRAINEE).length,
    1,
    "a dual-enrolled trainee must receive exactly one notification",
  );
});

test("an offering that is not eligible contributes no recipient", () => {
  // The Level-2 audience row exists but its capability is off: its trainees are
  // not notified, and the dual trainee still arrives only through Level 1.
  const recipients = recipientsFor([
    liveOffering(LEVEL_1_OFFERING_ID),
    { courseOfferingId: LEVEL_2_OFFERING_ID, offeringActive: true, materialsCapabilityEnabled: false },
  ]);
  assert.deepEqual(recipients, [LEVEL_1_ONLY_TRAINEE, DUAL_TRAINEE]);
});

test("a not-live enrollment is excluded", () => {
  const recipients = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)], [
    { ...liveEnrollment(LEVEL_1_ONLY_TRAINEE, LEVEL_1_OFFERING_ID), enrollmentActive: false },
    liveEnrollment(DUAL_TRAINEE, LEVEL_1_OFFERING_ID),
  ]);
  assert.deepEqual(recipients, [DUAL_TRAINEE]);
});

test("a not-live trainee is excluded", () => {
  const recipients = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)], [
    { ...liveEnrollment(LEVEL_1_ONLY_TRAINEE, LEVEL_1_OFFERING_ID), traineeActive: false },
    liveEnrollment(DUAL_TRAINEE, LEVEL_1_OFFERING_ID),
  ]);
  assert.deepEqual(recipients, [DUAL_TRAINEE]);
});

test("a dual trainee whose ONE live enrollment is not eligible is still not notified twice", () => {
  // Level 2 enrollment is dead; Level 1 is live. Exactly one notification.
  const recipients = recipientsFor(
    [liveOffering(LEVEL_1_OFFERING_ID), liveOffering(LEVEL_2_OFFERING_ID)],
    [
      liveEnrollment(DUAL_TRAINEE, LEVEL_1_OFFERING_ID),
      { ...liveEnrollment(DUAL_TRAINEE, LEVEL_2_OFFERING_ID), enrollmentActive: false },
    ],
  );
  assert.deepEqual(recipients, [DUAL_TRAINEE]);
});

test("a truthy non-boolean never qualifies an enrollment or a trainee", () => {
  for (const value of TRUTHY_NON_BOOLEANS) {
    for (const field of ["enrollmentActive", "traineeActive"]) {
      assert.deepEqual(
        resolveMaterialNotificationRecipientIds(
          [
            {
              ...liveEnrollment(LEVEL_1_ONLY_TRAINEE, LEVEL_1_OFFERING_ID),
              [field]: value,
            } as unknown as MaterialNotificationEnrollmentRow,
          ],
          [LEVEL_1_OFFERING_ID],
        ),
        [],
      );
    }
  }
});

test("an empty eligible set or an empty roster notifies nobody", () => {
  assert.deepEqual(resolveMaterialNotificationRecipientIds(ROSTER, []), []);
  assert.deepEqual(resolveMaterialNotificationRecipientIds([], [LEVEL_1_OFFERING_ID]), []);
  assert.deepEqual(
    resolveMaterialNotificationRecipientIds(
      undefined as unknown as MaterialNotificationEnrollmentRow[],
      undefined as unknown as string[],
    ),
    [],
  );
});

test("a malformed id in a roster row refuses the whole fan-out", () => {
  assert.throws(
    () =>
      resolveMaterialNotificationRecipientIds(
        [
          liveEnrollment(LEVEL_1_ONLY_TRAINEE, LEVEL_1_OFFERING_ID),
          { ...liveEnrollment("", LEVEL_1_OFFERING_ID) },
        ],
        [LEVEL_1_OFFERING_ID],
      ),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "studentId");
      assert.equal(refusal.index, 1);
      return true;
    },
  );

  assert.throws(
    () =>
      resolveMaterialNotificationRecipientIds(
        [{ ...liveEnrollment(LEVEL_1_ONLY_TRAINEE, "  ") }],
        [LEVEL_1_OFFERING_ID],
      ),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "courseOfferingId");
      assert.equal(refusal.index, 0);
      return true;
    },
  );

  // A malformed id in the ELIGIBLE list is refused before any row is read.
  assert.throws(
    () => resolveMaterialNotificationRecipientIds(ROSTER, ["", LEVEL_1_OFFERING_ID]),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "courseOfferingId");
      assert.equal(refusal.index, 0);
      return true;
    },
  );
});

// ===========================================================================
// M3A - the newly-eligible delta
// ===========================================================================

test("adding Level 2 to a Level 1 material notifies only the newly eligible", () => {
  const previous = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)]);
  const next = recipientsFor([
    liveOffering(LEVEL_1_OFFERING_ID),
    liveOffering(LEVEL_2_OFFERING_ID),
  ]);
  const delta = resolveNewlyEligibleMaterialNotificationRecipientIds(next, previous);

  assert.deepEqual(delta, [LEVEL_2_ONLY_TRAINEE]);
  assert.ok(!delta.includes(LEVEL_1_ONLY_TRAINEE), "an unchanged Level-1 trainee is not re-notified");
  assert.ok(
    !delta.includes(DUAL_TRAINEE),
    "a dual trainee already had access through Level 1 and must not be re-notified",
  );
});

test("a remove-and-add save does not re-notify someone who never lost access", () => {
  // previous {Level 1} -> new {Level 2}. The dual trainee could see the material
  // before AND after, so nothing became newly eligible for them.
  const previous = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)]);
  const next = recipientsFor([liveOffering(LEVEL_2_OFFERING_ID)]);
  const delta = resolveNewlyEligibleMaterialNotificationRecipientIds(next, previous);

  assert.deepEqual(delta, [LEVEL_2_ONLY_TRAINEE]);
  assert.ok(
    !delta.includes(DUAL_TRAINEE),
    "subtracting the WHOLE previous recipient set is what makes this correct",
  );
});

test("an identical audience save produces an empty delta", () => {
  const audience = [liveOffering(LEVEL_1_OFFERING_ID), liveOffering(LEVEL_2_OFFERING_ID)];
  const recipients = recipientsFor(audience);
  assert.deepEqual(
    resolveNewlyEligibleMaterialNotificationRecipientIds(recipients, recipients),
    [],
  );
});

test("a metadata-only edit produces an empty delta", () => {
  // Nothing about the audience changed, so both sides resolve identically -
  // editing a title, a description or a URL can never notify anyone.
  const before = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)]);
  const after = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)]);
  assert.deepEqual(resolveNewlyEligibleMaterialNotificationRecipientIds(after, before), []);
});

test("removing an audience produces an empty delta", () => {
  const previous = recipientsFor([
    liveOffering(LEVEL_1_OFFERING_ID),
    liveOffering(LEVEL_2_OFFERING_ID),
  ]);
  const next = recipientsFor([liveOffering(LEVEL_1_OFFERING_ID)]);
  assert.deepEqual(
    resolveNewlyEligibleMaterialNotificationRecipientIds(next, previous),
    [],
    "a pure removal never sends MATERIAL_ADDED",
  );
});

test("a brand-new material has no previous recipients and notifies its whole audience", () => {
  const next = recipientsFor([liveOffering(LEVEL_2_OFFERING_ID)]);
  assert.deepEqual(resolveNewlyEligibleMaterialNotificationRecipientIds(next, []), [
    LEVEL_2_ONLY_TRAINEE,
    DUAL_TRAINEE,
  ]);
});

test("the delta deduplicates, preserves first-seen order, and never mutates its inputs", () => {
  const next = ["c", "a", "b", "a", "c"];
  const previous = ["b", "b"];
  const nextCopy = [...next];
  const previousCopy = [...previous];

  assert.deepEqual(
    resolveNewlyEligibleMaterialNotificationRecipientIds(next, previous),
    ["c", "a"],
  );
  assert.deepEqual(next, nextCopy, "the new list must not be mutated");
  assert.deepEqual(previous, previousCopy, "the previous list must not be mutated");
});

test("a malformed id in either delta list refuses the whole fan-out", () => {
  assert.throws(
    () => resolveNewlyEligibleMaterialNotificationRecipientIds(["a", ""], []),
    (error: unknown) => {
      const refusal = asIdError(error);
      assert.equal(refusal.field, "studentId");
      assert.equal(refusal.index, 1);
      return true;
    },
  );
  assert.throws(
    () => resolveNewlyEligibleMaterialNotificationRecipientIds(["a"], [null as unknown as string]),
    MaterialNotificationIdError,
  );
});

// ===========================================================================
// M3A - immutability, ordering and non-mutation guarantees
// ===========================================================================

test("every new resolver returns a FROZEN array", () => {
  const eligible = resolveEligibleMaterialNotificationOfferingIds([
    liveOffering(LEVEL_1_OFFERING_ID),
  ]);
  const recipients = resolveMaterialNotificationRecipientIds(ROSTER, eligible);
  const delta = resolveNewlyEligibleMaterialNotificationRecipientIds(recipients, []);

  for (const result of [eligible, recipients, delta]) {
    assert.equal(Object.isFrozen(result), true);
    assert.throws(() => (result as string[]).push("injected"), TypeError);
  }
});

test("the two ORIGINAL dedupers keep their existing unfrozen contract", () => {
  // M3A is additive: changing the committed dedupers' return shape would be a
  // behaviour change to an already-tested contract, so it deliberately did not
  // happen.
  assert.equal(
    Object.isFrozen(dedupeMaterialNotificationOfferingIds([{ courseOfferingId: LEVEL_1_OFFERING_ID }])),
    false,
  );
  assert.equal(
    Object.isFrozen(dedupeMaterialNotificationRecipientIds([{ studentId: LEVEL_1_ONLY_TRAINEE }])),
    false,
  );
});

test("the new resolvers never mutate their inputs and are deterministic", () => {
  const audience = [liveOffering(LEVEL_2_OFFERING_ID), liveOffering(LEVEL_1_OFFERING_ID)];
  const audienceSnapshot = JSON.stringify(audience);
  const rosterSnapshot = JSON.stringify(ROSTER);

  const first = recipientsFor(audience);
  const second = recipientsFor(audience);

  assert.deepEqual(first, second, "identical input always yields identical output");
  assert.equal(JSON.stringify(audience), audienceSnapshot, "the audience is not mutated");
  assert.equal(JSON.stringify(ROSTER), rosterSnapshot, "the roster is not mutated");
});

test("the new resolvers never trim, fold or otherwise rewrite an identifier", () => {
  const padded = ` ${LEVEL_1_OFFERING_ID} `;
  assert.deepEqual(resolveEligibleMaterialNotificationOfferingIds([liveOffering(padded)]), [padded]);

  // A padded offering id is a DIFFERENT offering: an enrollment into the
  // unpadded id must not match it.
  assert.deepEqual(
    resolveMaterialNotificationRecipientIds(
      [liveEnrollment(LEVEL_1_ONLY_TRAINEE, LEVEL_1_OFFERING_ID)],
      [padded],
    ),
    [],
  );

  const mixedCase = "Trainee-A";
  assert.deepEqual(
    resolveNewlyEligibleMaterialNotificationRecipientIds([mixedCase], ["trainee-a"]),
    [mixedCase],
    "case folding would silently drop a real recipient",
  );
});

test("a refusal from the new resolvers is still PII-free", () => {
  const PII = { fullName: "שרה כהן", phone: "0501234567", identityNumber: "123456789" };

  assert.throws(
    () =>
      resolveMaterialNotificationRecipientIds(
        [
          liveEnrollment(LEVEL_1_ONLY_TRAINEE, LEVEL_1_OFFERING_ID),
          { ...liveEnrollment(LEVEL_2_ONLY_TRAINEE, LEVEL_1_OFFERING_ID), studentId: PII },
        ] as unknown as MaterialNotificationEnrollmentRow[],
        [LEVEL_1_OFFERING_ID],
      ),
    (error: unknown) => {
      const refusal = asIdError(error);
      const own = refusal as unknown as Record<string, unknown>;
      const surfaces = [
        refusal.message,
        String(refusal),
        JSON.stringify(refusal),
        JSON.stringify(Object.getOwnPropertyNames(refusal).map((key) => own[key])),
      ].join("\n");

      for (const secret of [PII.fullName, PII.phone, PII.identityNumber, LEVEL_1_ONLY_TRAINEE]) {
        assert.ok(!surfaces.includes(secret), `must not disclose ${JSON.stringify(secret)}`);
      }
      assert.equal(refusal.field, "studentId");
      assert.equal(refusal.index, 1);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Purity of this core
// ---------------------------------------------------------------------------

test("the core has no runtime import at all", () => {
  const src = readCode(`./${MODULE_FILE}`);
  const valueImports = [
    ...src.matchAll(/^\s*import\s+(?!type\b)[\s\S]*?from\s*["']([^"']+)["']/gm),
  ].map((m) => m[1]);
  const bareImports = [...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  const dynamicImports = [...src.matchAll(/\bimport\s*\(/g)].map((m) => m[0]);
  const requires = [...src.matchAll(/\brequire\s*\(/g)].map((m) => m[0]);

  assert.deepEqual([...valueImports, ...bareImports], []);
  assert.deepEqual(dynamicImports, []);
  assert.deepEqual(requires, []);

  // The single import is type-only and therefore fully erased at runtime.
  const typeImports = [...src.matchAll(/^\s*import\s+type[\s\S]*?from\s*["']([^"']+)["']/gm)].map(
    (m) => m[1],
  );
  assert.deepEqual(typeImports, ["./capability-keys"]);
});

test("the core touches no impure or out-of-scope surface", () => {
  const src = readCode(`./${MODULE_FILE}`);
  const forbidden = [
    // IO / environment / non-determinism
    "prisma",
    "Prisma",
    "next/headers",
    "next/cache",
    "cookies(",
    "process.env",
    "Date",
    "Math.random",
    "console.",
    "fetch(",
    "use server",
    // Adjacent surfaces this slice must not reach into. (The module's OWN
    // "…Notification…" export names are why the bare word is not listed here -
    // these are the real production symbols it must not touch.)
    "createMaterialAddedNotifications",
    "notificationsWhere",
    "webpush",
    "web-push",
    "sendNewMessagePush",
    "messageTask",
    "MessageTaskRecipient",
    "courseMaterial",
    "createMany",
    "getStudentMaterials",
    "requireAdmin",
    "getCurrentTrainee",
    "getCurrentInstructor",
    // Course-scope inference that is forbidden outright
    "resolveCurrentCourseOffering",
    "groupName",
    "subgroupNumber",
    "startDate",
    "endDate",
    "activityYear",
  ];
  for (const token of forbidden) {
    assert.ok(!src.includes(token), `the pure core must not reference ${token}`);
  }
});

test("the core does not restate effective-capability evaluation", () => {
  // The whole point of the slice: capability EVALUATION stays in the committed
  // effective-capability core behind getEffectiveCapabilities. A second copy
  // here would be a silently-drifting authorization path.
  const src = readCode(`./${MODULE_FILE}`);
  const forbidden = [
    "ENABLED",
    "READ_ONLY",
    "DISABLED",
    "getEffectiveCapabilities",
    "EffectiveCapabilityStatus",
    "resolveEffectiveCapabilitiesFromRows",
    "CapabilityCatalog",
    "CAPABILITY_CATALOG",
    "capabilityKey",
    "dependsOn",
    "defaultEnabled",
    "isActive",
  ];
  for (const token of forbidden) {
    assert.ok(!src.includes(token), `capability evaluation must not be restated (${token})`);
  }

  // The ONE capability-layer value it may hold is the key constant itself.
  assert.ok(src.includes('"COURSE_MATERIALS"'));
});

test("M3A compares no lifecycle status value anywhere in the module", () => {
  // The M3A resolvers consume ALREADY-RESOLVED booleans. If a lifecycle literal
  // ever appears in code here, some status decision has been re-implemented -
  // which is precisely the second, silently-drifting authorization path this
  // module exists to avoid.
  const src = readCode(`./${MODULE_FILE}`);
  for (const literal of [
    "ACTIVE",
    "INACTIVE",
    "PLANNED",
    "ARCHIVED",
    "status",
    "offeringStatus",
    "enrollmentStatus",
  ]) {
    assert.ok(!src.includes(literal), `M3A must not compare a lifecycle value (${literal})`);
  }
});

test("M3A adds no import and keeps every flag strictly boolean", () => {
  const src = readCode(`./${MODULE_FILE}`);

  // Additive purity: still exactly one type-only import after M3A.
  const allImports = [...src.matchAll(/^\s*import\b/gm)];
  assert.equal(allImports.length, 1, "M3A must not add an import of any kind");

  // Every flag is compared with a STRICT identity test against `true`. A truthy
  // check (`if (row.offeringActive)`) would let `1` or `"ENABLED"` through.
  for (const flag of [
    "offeringActive",
    "materialsCapabilityEnabled",
    "enrollmentActive",
    "traineeActive",
  ]) {
    assert.ok(
      new RegExp(`"${flag}"\\)\\s*!==\\s*true`).test(src),
      `${flag} must be tested with a strict !== true comparison`,
    );
  }
  assert.ok(
    /materialActive === true/.test(src),
    "the material gate must test its live flag with a strict === true comparison",
  );
});

test("the module's exported surface is exactly the M3A inventory", () => {
  const src = readCode(`./${MODULE_FILE}`);
  const exported = [
    ...src.matchAll(/^export (?:async )?(?:function|const|class|interface|type) (\w+)/gm),
  ]
    .map((m) => m[1])
    .sort();

  assert.deepEqual(exported, [
    // Original L2-MATERIAL-NOTIFY-1 surface - preserved unchanged by M3A.
    "MATERIAL_NOTIFICATION_CAPABILITY_KEY",
    "MaterialNotificationEnrollmentRow",
    "MaterialNotificationIdError",
    "MaterialNotificationIdField",
    "MaterialNotificationOfferingRow",
    "dedupeMaterialNotificationOfferingIds",
    "dedupeMaterialNotificationRecipientIds",
    // M3A additions.
    "resolveEligibleMaterialNotificationOfferingIds",
    "resolveMaterialNotificationRecipientIds",
    "resolveNewlyEligibleMaterialNotificationRecipientIds",
    "shouldMaterialNotifyTrainees",
    "shouldNotifyTrainees",
  ]);
});

// ---------------------------------------------------------------------------
// Unwired
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCAN_ROOTS = ["app", "lib", "scripts", "prisma"];
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".git",
  "generated", // app/generated is machine-generated Prisma output
]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function collectSourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, found);
    } else if (SCAN_EXTENSIONS.has(path.extname(entry))) {
      found.push(full);
    }
  }
  return found;
}

test("exactly one approved production shell imports this module", () => {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const full = path.join(REPO_ROOT, root);
    try {
      if (statSync(full).isDirectory()) collectSourceFiles(full, files);
    } catch {
      // A scan root that does not exist is simply skipped.
    }
  }

  // Sanity check: the walker really did scan the tree it claims to.
  assert.ok(files.length > 100, `expected a populated scan, walked ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith(path.join("lib", "actions", "notifications.ts"))));
  assert.ok(files.some((f) => f.endsWith(path.join("lib", "actions", "materials.ts"))));

  // WIRING IS AN IMPORT, NOT A MENTION.
  //
  // This previously matched any raw textual occurrence of the module name, which
  // made three files that merely NAME the core in prose count as wiring: the M2B
  // suppression comment in lib/actions/notifications.ts, the cross-reference
  // docstring in lib/course/material-audience-reconcile-core.ts, and the
  // readSource("...") argument in lib/actions/materials-writer-audience-contract.
  // test.ts. None of them imports anything, so the invariant was reported broken
  // while the core was in fact entirely unwired.
  //
  // The matcher is NARROWED, never weakened: an ES module import is the only way
  // to consume this module, and every such import must carry a `from "<path>"`
  // specifier. Requiring `from` therefore still catches every real importer -
  // including a renamed, multi-line, type-only or deep-relative one - while prose
  // and a bare string argument correctly do not count.
  const IMPORT_MATCHER = /from\s*["'][^"']*material-notification-recipient-core["']/;

  // Both directions of the matcher are pinned here, in memory, so a future edit
  // cannot quietly turn this invariant into a test that can never fail.
  for (const wiring of [
    'import { shouldNotifyTrainees } from "./material-notification-recipient-core";',
    "import { dedupeMaterialNotificationRecipientIds } from '../capabilities/material-notification-recipient-core';",
    'import type { MaterialNotificationOfferingRow } from "@/lib/course/capabilities/material-notification-recipient-core";',
    'import {\n  shouldMaterialNotifyTrainees,\n} from "./material-notification-recipient-core";',
  ]) {
    assert.ok(IMPORT_MATCHER.test(wiring), `a real import must count as wiring: ${wiring}`);
  }
  for (const mention of [
    "// via the already-built lib/course/capabilities/material-notification-recipient-core.ts",
    " * discipline of ./capabilities/material-notification-recipient-core.ts",
    'const core = readSource("./../course/capabilities/material-notification-recipient-core.ts");',
  ]) {
    assert.ok(!IMPORT_MATCHER.test(mention), `a mention must not count as wiring: ${mention}`);
  }

  const importers = files
    .filter((file) => {
      const base = path.basename(file);
      if (base === MODULE_FILE || base === TEST_FILE) return false;
      return IMPORT_MATCHER.test(readFileSync(file, "utf8"));
    })
    .map((file) => path.relative(REPO_ROOT, file).replace(/\\/g, "/"))
    .sort();

  // P-MATERIALS M3B - INVERTED, NOT RELAXED.
  //
  // Through M3A this asserted the core had NO importer at all, with the standing
  // instruction that the slice which legitimately wires it must update this
  // assertion rather than delete it. M3B is that slice. The invariant it now
  // guards is the one that actually matters going forward: the core is consumed
  // by EXACTLY ONE approved IO shell. A second importer would be a second
  // recipient-resolution path, free to drift from this one - which is precisely
  // what the original "stay unwired" rule existed to prevent.
  //
  // EXACT equality, never a subset: an unapproved new importer fails, and so does
  // a stale entry left behind if the shell is renamed or removed. The shell's own
  // focused test is listed because it exercises the core's typed refusal directly;
  // it is not a second resolution path, and the production assertion below is what
  // actually pins the invariant.
  const SHELL = "lib/course/capabilities/material-notification-trainee-recipients.ts";
  assert.deepEqual(
    importers,
    [SHELL.replace(/\.ts$/, ".test.ts"), SHELL],
    "only the approved IO shell and its own focused test may consume the pure core",
  );

  const productionImporters = importers.filter((file) => !file.endsWith(".test.ts"));
  assert.deepEqual(
    productionImporters,
    [SHELL],
    "exactly ONE production module may consume the pure recipient core",
  );

  // The shell must be a real consumer of the DECISIONS, not merely an importer of
  // a type - otherwise this tripwire could pass while the resolution logic was
  // quietly reimplemented somewhere else.
  const shell = readFileSync(path.join(REPO_ROOT, SHELL), "utf8");
  for (const decision of [
    "shouldMaterialNotifyTrainees",
    "resolveEligibleMaterialNotificationOfferingIds",
    "resolveMaterialNotificationRecipientIds",
  ]) {
    assert.ok(shell.includes(decision), `the approved shell must consume ${decision}`);
  }
});
