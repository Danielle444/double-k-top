/**
 * MULTI-COURSE (staged-trainee activation guard, Slice G1) - DB-free tests for the
 * PURE staged-trainee activation classification core.
 *
 * Run with: npx tsx --test lib/course/staged-trainee-activation-core.test.ts
 * PURE: no Prisma, no DB, no clock, no randomness, no auth, no cookie, no env.
 * Every case is a plain object fed to isStagedTraineeActivationBlocked.
 *
 * These prove Rule C exactly (the ACTIVE-offering override, the PLANNED trigger,
 * and every non-blocking population), the explicit fail-closed behavior for
 * runtime-malformed input, order independence, input immutability, the exact
 * approved Hebrew strings, and - by static source inspection - that the module
 * takes on no forbidden dependency and consults no group mirror / level / name /
 * id. The production implementation is never cast to `any`; only deliberately
 * malformed TEST DATA is cast at the call boundary.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isStagedTraineeActivationBlocked,
  STAGED_TRAINEE_ROW_LABEL,
  STAGED_TRAINEE_ACTIVATION_TOOLTIP,
  STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE,
  type ActivationEnrollmentInput,
} from "./staged-trainee-activation-core";

// ---------------------------------------------------------------------------
// Builders (well-formed rows only; malformed data is cast explicitly per test)
// ---------------------------------------------------------------------------

const activeInPlanned: ActivationEnrollmentInput = {
  status: "ACTIVE",
  offeringStatus: "PLANNED",
};
const activeInActive: ActivationEnrollmentInput = {
  status: "ACTIVE",
  offeringStatus: "ACTIVE",
};
const activeInArchived: ActivationEnrollmentInput = {
  status: "ACTIVE",
  offeringStatus: "ARCHIVED",
};
const inactiveInPlanned: ActivationEnrollmentInput = {
  status: "INACTIVE",
  offeringStatus: "PLANNED",
};
const inactiveInActive: ActivationEnrollmentInput = {
  status: "INACTIVE",
  offeringStatus: "ACTIVE",
};
const inactiveInArchived: ActivationEnrollmentInput = {
  status: "INACTIVE",
  offeringStatus: "ARCHIVED",
};

const INACTIVE_TRAINEE = false;
const ACTIVE_TRAINEE = true;

// ---------------------------------------------------------------------------
// 1-8. Rule C core population matrix
// ---------------------------------------------------------------------------

test("1. inactive + one ACTIVE enrollment in a PLANNED offering -> blocked", () => {
  assert.equal(isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [activeInPlanned]), true);
});

test("2. inactive + ACTIVE enrollment in an ACTIVE offering -> not blocked", () => {
  assert.equal(isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [activeInActive]), false);
});

test("3. inactive dual-enrolled (ACTIVE->ACTIVE and ACTIVE->PLANNED) -> not blocked", () => {
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [activeInActive, activeInPlanned]),
    false,
  );
});

test("4. inactive with no enrollments -> not blocked (legacy reactivation preserved)", () => {
  assert.equal(isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, []), false);
});

test("5. inactive with only an ACTIVE enrollment in an ARCHIVED offering -> not blocked", () => {
  assert.equal(isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [activeInArchived]), false);
});

test("6. inactive with only an INACTIVE enrollment in a PLANNED offering -> not blocked", () => {
  assert.equal(isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [inactiveInPlanned]), false);
});

test("7. an ALREADY ACTIVE trainee with an ACTIVE enrollment in a PLANNED offering -> not blocked", () => {
  assert.equal(isStagedTraineeActivationBlocked(ACTIVE_TRAINEE, [activeInPlanned]), false);
});

test("8. several ACTIVE PLANNED enrollments and no ACTIVE offering -> blocked", () => {
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [
      activeInPlanned,
      activeInPlanned,
      activeInPlanned,
    ]),
    true,
  );
});

// ---------------------------------------------------------------------------
// 9-11. Additive rows must not change the answer / ACTIVE-offering override
// ---------------------------------------------------------------------------

test("9. adding an INACTIVE historical enrollment does not change either result", () => {
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [
      activeInPlanned,
      inactiveInActive,
      inactiveInArchived,
      inactiveInPlanned,
    ]),
    true,
    "an INACTIVE row can never clear a blocked trainee",
  );
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [inactiveInPlanned, inactiveInActive]),
    false,
    "an INACTIVE row can never block an otherwise-clear trainee",
  );
});

test("10. adding an ARCHIVED-offering enrollment does not change either result", () => {
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [activeInPlanned, activeInArchived]),
    true,
    "an ARCHIVED-offering row can never clear a blocked trainee",
  );
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, [activeInArchived]),
    false,
    "an ARCHIVED-offering row can never block on its own",
  );
});

test("11. one ACTIVE-offering enrollment outranks ANY number of PLANNED ones", () => {
  for (let plannedCount = 1; plannedCount <= 5; plannedCount++) {
    const rows: ActivationEnrollmentInput[] = [
      ...Array.from({ length: plannedCount }, () => activeInPlanned),
      activeInActive,
    ];
    assert.equal(
      isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, rows),
      false,
      `${plannedCount} PLANNED row(s) must not defeat the single ACTIVE-offering row`,
    );
  }
});

// ---------------------------------------------------------------------------
// 12-13. Order independence and immutability
// ---------------------------------------------------------------------------

test("12. input order does not affect the result", () => {
  const rows = [activeInPlanned, inactiveInActive, activeInArchived, activeInActive];
  const permutations: ActivationEnrollmentInput[][] = [
    [rows[0], rows[1], rows[2], rows[3]],
    [rows[3], rows[2], rows[1], rows[0]],
    [rows[2], rows[0], rows[3], rows[1]],
    [rows[1], rows[3], rows[0], rows[2]],
  ];
  for (const permutation of permutations) {
    assert.equal(isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, permutation), false);
  }

  const blockedRows = [activeInPlanned, inactiveInActive, activeInArchived];
  const blockedPermutations: ActivationEnrollmentInput[][] = [
    [blockedRows[0], blockedRows[1], blockedRows[2]],
    [blockedRows[2], blockedRows[1], blockedRows[0]],
    [blockedRows[1], blockedRows[2], blockedRows[0]],
  ];
  for (const permutation of blockedPermutations) {
    assert.equal(isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, permutation), true);
  }
});

test("13. the input array and its rows are never mutated", () => {
  const rows: ActivationEnrollmentInput[] = [
    { status: "ACTIVE", offeringStatus: "PLANNED" },
    { status: "INACTIVE", offeringStatus: "ARCHIVED" },
    { status: "ACTIVE", offeringStatus: "ACTIVE" },
  ];
  const snapshot = JSON.parse(JSON.stringify(rows));
  isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, rows);
  isStagedTraineeActivationBlocked(ACTIVE_TRAINEE, rows);
  assert.deepEqual(rows, snapshot, "the classifier must not mutate its input");
  assert.equal(rows.length, 3);
});

// ---------------------------------------------------------------------------
// 14-16. Malformed-input policy (fail closed, but only on an activation attempt)
// ---------------------------------------------------------------------------

test("14. a valid EMPTY list is not treated as malformed", () => {
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, []),
    false,
    "an empty enrollment history is the legitimate legacy case, not a data failure",
  );
});

test("15. a runtime-malformed row while the trainee is INACTIVE -> blocked (fail closed)", () => {
  const malformedRows: unknown[] = [
    { status: "BOGUS", offeringStatus: "PLANNED" },
    { status: "ACTIVE", offeringStatus: "BOGUS" },
    { status: "ACTIVE" },
    { offeringStatus: "PLANNED" },
    {},
    null,
    undefined,
    "ACTIVE",
    42,
    [],
    { status: 1, offeringStatus: 2 },
    { status: null, offeringStatus: null },
    // Inherited (non-own) keys must not resolve through the prototype chain.
    Object.create({ status: "ACTIVE", offeringStatus: "ACTIVE" }),
    // A hostile row must fail closed, not throw.
    {
      get status() {
        throw new Error("must never be reached in a way that escapes");
      },
    },
  ];

  for (const malformed of malformedRows) {
    const rows = [malformed] as unknown as ActivationEnrollmentInput[];
    assert.equal(
      isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, rows),
      true,
      `malformed row ${JSON.stringify(String(malformed))} must fail closed`,
    );
  }
});

test("15b. a malformed row outranks an otherwise-clearing ACTIVE-offering row", () => {
  const rows = [
    activeInActive,
    { status: "BOGUS", offeringStatus: "PLANNED" },
  ] as unknown as ActivationEnrollmentInput[];
  assert.equal(
    isStagedTraineeActivationBlocked(INACTIVE_TRAINEE, rows),
    true,
    "fail-closed must outrank clearing",
  );
});

test("15c. a non-array enrollments argument while INACTIVE -> blocked (fail closed)", () => {
  for (const notAnArray of [null, undefined, "ACTIVE", 7, {}]) {
    assert.equal(
      isStagedTraineeActivationBlocked(
        INACTIVE_TRAINEE,
        notAnArray as unknown as ActivationEnrollmentInput[],
      ),
      true,
    );
  }
});

test("15d. a runtime-malformed active state -> blocked (fail closed)", () => {
  for (const notABoolean of [null, undefined, 0, 1, "false", "true", {}]) {
    assert.equal(
      isStagedTraineeActivationBlocked(notABoolean as unknown as boolean, [activeInActive]),
      true,
      "an untrustworthy active state must never clear an activation",
    );
  }
});

test("16. a malformed row while the trainee is ALREADY ACTIVE -> not blocked", () => {
  const rows = [
    { status: "BOGUS", offeringStatus: "BOGUS" },
    null,
  ] as unknown as ActivationEnrollmentInput[];
  assert.equal(
    isStagedTraineeActivationBlocked(ACTIVE_TRAINEE, rows),
    false,
    "no activation transition is being attempted, so nothing can be blocked",
  );
  assert.equal(
    isStagedTraineeActivationBlocked(
      ACTIVE_TRAINEE,
      undefined as unknown as ActivationEnrollmentInput[],
    ),
    false,
  );
});

test("the classifier never throws for any of the sampled inputs", () => {
  const samples: unknown[] = [
    [],
    [activeInPlanned],
    [null],
    [{ status: "ACTIVE" }],
    "not-an-array",
    null,
    undefined,
  ];
  for (const activeState of [true, false, null, undefined, "x"]) {
    for (const sample of samples) {
      assert.doesNotThrow(() =>
        isStagedTraineeActivationBlocked(
          activeState as unknown as boolean,
          sample as unknown as ActivationEnrollmentInput[],
        ),
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 17. Exact approved Hebrew strings
// ---------------------------------------------------------------------------

test("17. the Hebrew constants match the approved text exactly", () => {
  assert.equal(STAGED_TRAINEE_ROW_LABEL, "בהכנה לקורס");
  assert.equal(
    STAGED_TRAINEE_ACTIVATION_TOOLTIP,
    "החניך/ה רשום/ה לקורס שנמצא בהכנה וטרם נפתח. הפעלת החשבון תתאפשר רק לאחר פתיחת הקורס ואישור ניהול המערכת.",
  );
  assert.equal(
    STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE,
    "לא ניתן להפעיל חשבון של חניך/ה שרשום/ה רק לקורס בהכנה. יש לפנות לניהול המערכת.",
  );
});

test("no constant interpolates a name, identity number, offering name, id or date", () => {
  const serialized = JSON.stringify([
    STAGED_TRAINEE_ROW_LABEL,
    STAGED_TRAINEE_ACTIVATION_TOOLTIP,
    STAGED_TRAINEE_ACTIVATION_BLOCKED_MESSAGE,
  ]);
  for (const forbidden of [
    "${",
    "studentId",
    "identityNumber",
    "firstName",
    "lastName",
    "fullName",
    "phone",
    "courseOfferingId",
    "courseGroupId",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `messages must not include ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 18-19. Static source proof: purity and no forbidden inputs
// ---------------------------------------------------------------------------

// Strip block and line comments so the invariants below are checked against real
// CODE only, never the (deliberately prose-y) contract comments.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const moduleSrc = stripComments(
  readFileSync(
    fileURLToPath(new URL("./staged-trainee-activation-core.ts", import.meta.url)),
    "utf8",
  ),
);

test("18a. the module imports no Prisma client instance and no runtime Prisma value", () => {
  assert.equal(moduleSrc.includes("@/lib/prisma"), false, "must not import the prisma client");
  assert.equal(moduleSrc.includes("prisma."), false, "must not reference prisma.*");
  assert.equal(moduleSrc.includes("PrismaClient"), false, "must not reference PrismaClient");
  assert.equal(moduleSrc.includes("$transaction"), false, "must not reference a transaction");

  // The generated client may be referenced ONLY through a type-only import.
  const generatedImports = moduleSrc.match(/import[^;]*?from\s+"@\/app\/generated\/prisma\/client"/g) ?? [];
  assert.equal(generatedImports.length, 1, "exactly one reference to the generated client");
  assert.ok(
    /^import\s+type\s/.test(generatedImports[0]),
    "the generated client must be imported with `import type` only",
  );
});

test("18b. the module takes on no auth, cookie, header, Next.js, clock, random or env dependency", () => {
  for (const forbidden of [
    "cookies(",
    "headers(",
    "next/",
    '"@/auth"',
    "requireAdmin",
    "getCurrentInstructor",
    "getCurrentStudent",
    "use server",
    "use client",
    "process.env",
    "Date.now",
    "new Date",
    "Math.random",
    "readFile",
    "fetch(",
    "revalidatePath",
    "redirect(",
  ]) {
    assert.equal(
      moduleSrc.includes(forbidden),
      false,
      `the pure core must not reference ${forbidden}`,
    );
  }
});

test("18c. the module performs no write of any kind", () => {
  for (const forbidden of [
    "student.update",
    "student.create",
    "setStudentActive",
    "courseEnrollment.create",
    "groupMembership.create",
    "update(",
    "create(",
    "delete(",
  ]) {
    assert.equal(moduleSrc.includes(forbidden), false, `the pure core must not reference ${forbidden}`);
  }
});

test("19. no group mirror / level / name / id logic exists in the module", () => {
  for (const forbidden of [
    /\bgroupName\b/,
    /\bsubgroupNumber\b/,
    /\blevel\b/,
    /\bname\b/,
    /\bid\b/,
    /\bstudentId\b/,
    /\bcourseOfferingId\b/,
    /\bcourseGroupId\b/,
    /\bisPrimary\b/,
    /\bstartDate\b/,
    /\beffectiveFrom\b/,
    /\bresolveCurrentCourseOffering\b/,
  ]) {
    assert.equal(
      forbidden.test(moduleSrc),
      false,
      `Rule C must not consult ${String(forbidden)}`,
    );
  }
});

test("19b. the two authoritative status inputs are the only fields read", () => {
  assert.ok(/\bstatus\b/.test(moduleSrc), "enrollment status is read");
  assert.ok(/\bofferingStatus\b/.test(moduleSrc), "offering status is read");
  // All three offering lifecycle values must be accounted for: PLANNED and ACTIVE
  // as explicit comparisons, ARCHIVED as a classified-but-non-triggering member of
  // the known-status table (it is handled by matching neither branch).
  for (const lifecycleValue of [/\bPLANNED\b/, /\bACTIVE\b/, /\bARCHIVED\b/]) {
    assert.ok(
      lifecycleValue.test(moduleSrc),
      `the offering lifecycle value ${String(lifecycleValue)} must be accounted for`,
    );
  }
  assert.ok(
    moduleSrc.includes('=== "PLANNED"') && moduleSrc.includes('=== "ACTIVE"'),
    "PLANNED and ACTIVE are the two explicitly compared offering states",
  );
});
