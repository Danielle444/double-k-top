/**
 * Executable tests for the pure ownership-scoped Prisma filter builders
 * (Stage 0A2 — push/notification self-service).
 *
 * Uses the existing `tsx` runner with Node built-ins `node:test` and
 * `node:assert/strict`. No test framework is installed. Run with:
 *   npx tsx --test lib/auth/notification-push-scope.test.ts
 *
 * These tests are PURE: they exercise only ./notification-push-scope (no
 * next/headers, no Prisma, no cookies). They lock the security property the
 * wired actions depend on — that every DB filter is bound to the SERVER-derived
 * actor id and the recipient role, so:
 *  - push-unsubscribe can never remove another trainee's subscription (the
 *    endpoint alone is never the scope; the actor's studentId is always ANDed);
 *  - a notification read/count is always scoped by the server actor id.
 *
 * The complementary auth decision (whether a client-supplied id may be honored,
 * and that the server id is always the value returned) is covered by
 * self-actor-authorization.test.ts and is NOT duplicated here.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  studentPushUnsubscribeWhere,
  studentNotificationsWhere,
  instructorNotificationsWhere,
  studentUnreadNotificationsWhere,
  instructorUnreadNotificationsWhere,
} from "./notification-push-scope";

const ACTOR = "actor-123";
const OTHER = "other-999";
const ENDPOINT = "https://push.example.com/ep/abc";

// --- push unsubscribe ------------------------------------------------------

// The delete filter is scoped by BOTH endpoint and the server actor's
// studentId, under recipientRole STUDENT — an endpoint alone is never the
// scope, so a globally-unique endpoint owned by another Student cannot match.
test("unsubscribe where is scoped by endpoint AND the server actor studentId", () => {
  assert.deepEqual(studentPushUnsubscribeWhere(ACTOR, ENDPOINT), {
    endpoint: ENDPOINT,
    recipientRole: "STUDENT",
    studentId: ACTOR,
  });
});

// Passing another trainee's endpoint still binds the filter to the ACTOR's
// studentId, so a deleteMany with this where can only ever remove the actor's
// own row — never the other trainee's subscription.
test("unsubscribe cannot target another trainee: studentId stays the server actor", () => {
  const where = studentPushUnsubscribeWhere(ACTOR, ENDPOINT);
  assert.equal(where.studentId, ACTOR);
  assert.notEqual(where.studentId, OTHER);
  // The endpoint is only ever an additional AND-constraint, not the sole scope.
  assert.ok("studentId" in where && "recipientRole" in where);
});

// --- notification reads ----------------------------------------------------

test("student notifications where is scoped by the server actor studentId", () => {
  assert.deepEqual(studentNotificationsWhere(ACTOR), {
    recipientRole: "STUDENT",
    studentId: ACTOR,
  });
});

test("instructor notifications where is scoped by the server actor instructorId", () => {
  assert.deepEqual(instructorNotificationsWhere(ACTOR), {
    recipientRole: "INSTRUCTOR",
    instructorId: ACTOR,
  });
});

// Audience isolation: the student filter keys on studentId (never
// instructorId) and the instructor filter keys on instructorId (never
// studentId), so neither can read across the trainee/instructor boundary.
test("read filters preserve audience isolation (no cross-role key)", () => {
  const s = studentNotificationsWhere(ACTOR);
  const i = instructorNotificationsWhere(ACTOR);
  assert.equal("instructorId" in s, false);
  assert.equal("studentId" in i, false);
});

// --- unread counts ---------------------------------------------------------

test("student unread where scopes by server actor and readAt=null", () => {
  assert.deepEqual(studentUnreadNotificationsWhere(ACTOR), {
    recipientRole: "STUDENT",
    studentId: ACTOR,
    readAt: null,
  });
});

test("instructor unread where scopes by server actor and readAt=null", () => {
  assert.deepEqual(instructorUnreadNotificationsWhere(ACTOR), {
    recipientRole: "INSTRUCTOR",
    instructorId: ACTOR,
    readAt: null,
  });
});
