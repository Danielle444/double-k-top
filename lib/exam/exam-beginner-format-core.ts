/**
 * EXAM EX-C2-0 — PURE practice-type → beginner-format mapping.
 *
 * PURE by construction: no Prisma, no DB, no Next, no clock (`Date.now`/`new
 * Date`), no randomness, no env, no auth/session/cookie, no filesystem, no
 * network. Deterministic; never mutates its inputs. This module has NO runtime
 * imports at all (the single import below is type-only and erased at build).
 *
 * WHAT THIS ANSWERS (and only this): given a raw `TeachingPracticeType` token,
 * which `ExamBeginnerFormat` does it denote?
 *
 * WHY IT LIVES HERE. This mapping was previously owned by the beginner COPY
 * planner (`exam-beginner-copy-core`). That planner is DEPRECATED — beginner
 * exams are now a LIVE PROJECTION of Teaching Practice, not a copy — but the
 * mapping itself survives the design change unchanged, because the live
 * projection must answer exactly the same question at read time that the copy
 * used to answer at copy time. It is extracted here so the live adapter does
 * not import a deprecated module, and re-exported from the planner so its
 * existing tests keep passing. The SEMANTICS ARE UNCHANGED — this is a move,
 * not a rewrite.
 *
 * FAIL CLOSED: an unknown token, a non-string, and an inherited/prototype key
 * all yield `null`. A caller must REJECT a lesson whose practice type does not
 * map; it must never substitute a default format.
 */
import type { ExamBeginnerFormat } from "./exam-domain-core";

/**
 * The frozen mapping table. `TeachingPracticeType` and `ExamBeginnerFormat`
 * happen to share their three token spellings, but they are two INDEPENDENT
 * enums in two independent modules: this table is the explicit, auditable
 * bridge between them, never an identity cast. If either enum ever gains a
 * value, that value is unmapped (→ `null`) until it is added here deliberately.
 */
const PRACTICE_TYPE_TO_FORMAT: Readonly<Record<string, ExamBeginnerFormat>> = Object.freeze({
  LUNGE: "LUNGE",
  BEGINNER_PRIVATE: "BEGINNER_PRIVATE",
  BEGINNER_GROUP: "BEGINNER_GROUP",
});

/**
 * Map a raw practice-type token to a beginner format, or `null` if unknown.
 *
 * The `hasOwnProperty` guard is load-bearing, not defensive noise: a plain
 * property read would resolve `"constructor"`, `"toString"` and `"__proto__"`
 * to inherited `Object.prototype` members and hand the caller a truthy
 * non-format value. Own-property lookup makes every prototype key a miss.
 */
export function mapPracticeTypeToBeginnerFormat(
  practiceType: unknown,
): ExamBeginnerFormat | null {
  if (typeof practiceType !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(PRACTICE_TYPE_TO_FORMAT, practiceType)) return null;
  return PRACTICE_TYPE_TO_FORMAT[practiceType];
}

/**
 * The mapping as read-only data, for tests and for any caller that needs to
 * enumerate the supported tokens. Frozen — callers cannot extend the mapping.
 */
export const PRACTICE_TYPE_FORMAT_MAP: Readonly<Record<string, ExamBeginnerFormat>> =
  PRACTICE_TYPE_TO_FORMAT;
