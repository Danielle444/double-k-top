# Level 2 Deferred Backlog

**Owner:** Double K Top — multi-course workstream
**Created:** 2026-07-24
**Launch target:** 2026-07-25 (narrow Level 2 experience)
**Status of this document:** living. Update it whenever a deferral is added, changed, or removed.

---

## Purpose and launch boundary

This document records **what was intentionally deferred**, and **what temporary compatibility
decisions were accepted**, in order to launch a deliberately narrow Level 2 experience by
2026-07-25.

It is **not** a list of approved immediate work. Nothing in this document may be implemented
because it appears here. Each item still requires its own scoped approval, its own audit, and the
project's mandatory post-change validation sequence.

The document exists because the launch is urgent and the application was built on a
**single-course assumption**. Rather than pretend that assumption has been removed, the launch
narrows the Level 2 surface to the few modules that are safe under a temporary compatibility
layer, and writes down — here — everything that was skipped, hidden, or blocked to get there.

### Status vocabulary used throughout

Every item is tagged with exactly one lifecycle status. Do not blur these.

| Status | Meaning |
| --- | --- |
| **COMMITTED** | Merged into `main`. Verified in the repository. Says nothing about production. |
| **PLANNED** | Agreed in principle, designed or audited, **not written**. |
| **PAUSED** | Started or designed, then deliberately stopped. Do not resume without a decision. |
| **TEMP-WORKAROUND** | Exists only to make the 2026-07-25 launch possible. Has a removal criterion. |
| **BACKLOG** | Post-launch. Not scheduled. |

> **COMMITTED never means deployed.** Several committed items (notably the WeeklySchedule
> migration) have **not** been applied to production. Deployment status is tracked separately in
> [Production and migration safety](#production-and-migration-safety).

### Launch scope (locked)

Level 2 trainees get exactly:

- login
- course-scoped schedule
- relevant contacts
- profile
- help

**Everything else** must be isolated, hidden, or server-blocked for Level 2 until proper
multi-course support exists. Navigation-only hiding is *not* sufficient on its own — see
[Must remove after launch, item 4](#must-remove-after-launch).

---

## Temporary launch architecture

This is the architecture the launch actually runs on. Every element is temporary.

### 1. Trainee course context — exactly one ACTIVE enrollment into an ACTIVE offering

**Status: TEMP-WORKAROUND**

A trainee's course context is derived from their `CourseEnrollment` rows: the context resolves
only when there is **exactly one** `ACTIVE` enrollment pointing at an **ACTIVE** `CourseOffering`.

- Zero such enrollments → **fail closed**, no course context.
- Two or more → **fail closed**, no course context. There is no "pick the newest", "pick the
  higher level", "pick the primary".
- The trainee never selects, and never sends, their own course context.

Deferred: real multi-enrollment support. See
[Login/session backlog](#loginsession-backlog).

### 2. Temporary instructor policy — all active instructors may access both course contexts

**Status: TEMP-WORKAROUND** *(policy updated 2026-07-24; supersedes the earlier instructor-id
allow-list approach, which is withdrawn)*

There is **no `Instructor ↔ CourseOffering` relation in the schema**, and adding one was
explicitly ruled out under this deadline (locked decision). For the urgent launch the temporary
policy is therefore:

- **Every active instructor may access both verified offerings** — Level 1
  (`cmrqngqhn00017gcndjixzrh0`) and Level 2 (`cmrxk58vc0000lscnfm54bpze`). Instructor staffing is
  not modelled per offering during the launch window.
- **There is no instructor allow-list.** No per-instructor id list exists, is required, or may be
  reintroduced. Access follows from `Instructor.isActive` alone.
- **Course context must still be explicit and server-validated.** The instructor does not gain a
  "both courses at once" view. Each read or write names exactly one offering, that offering id is
  resolved and validated **on the server**, and it is never taken from a client-supplied value, a
  cookie, or a URL parameter that was not re-verified against a real ACTIVE offering.
- **This does not authorize global mixed-course readers.** Being permitted to enter either context
  is not permission to query across both. A reader that returns Level 1 and Level 2 rows in one
  result set is still a defect, and every reader listed in
  [Schedule roadmap](#schedule-roadmap) and [Module-isolation backlog](#module-isolation-backlog)
  still requires isolation.
- **`Instructor.isActive` remains the containment lever.** It is account-wide emergency
  containment, not per-device or per-course. Under this policy it is also the only mechanism that
  removes an instructor from a course context.

**Removal criterion:** replaced by a permanent `Instructor ↔ CourseOffering` association (see
[Must remove after launch, item 1](#must-remove-after-launch)).

> **Note on the uncommitted code — not owned by this document.** The working tree still contains
> the earlier allow-list mechanism: `isTemporaryLevel2Instructor` /
> `temporaryLevel2InstructorCount` in
> [lib/course/temporary-level2-compatibility.ts](lib/course/temporary-level2-compatibility.ts),
> imported by the untracked actor-aware resolver
> [lib/course/actor-course-offering.ts](lib/course/actor-course-offering.ts). Reconciling that
> code with the policy above belongs to the **active L2-0 implementation conversation**, not to
> this backlog, and is deliberately not tracked as a cleanup item here.
>
> Worth recording as context: the actor-aware resolvers fit the "explicit and server-validated"
> requirement well — both take **no arguments** and derive the actor id from the signed session,
> so no client-supplied trainee, instructor, or offering id is accepted. They are **un-wired**;
> no schedule, contacts, navigation, or UI reader imports them yet.

### 3. Temporary explicit Level 1 compatibility offering

**Status: TEMP-WORKAROUND — uncommitted**

`resolveCurrentCourseOffering()` is a **singleton** resolver: it throws
`AmbiguousCourseOfferingError` the moment two offerings are `ACTIVE`. Many live Level 1 paths
depend on it. Activating Level 2 would break all of them at once.

The bridge is an **explicit, id-based** statement of "the established Level 1 offering":

- `LEVEL_1_COURSE_OFFERING_ID` and `LEVEL_2_COURSE_OFFERING_ID` are exact primary keys, held in
  [lib/course/temporary-level2-compatibility.ts](lib/course/temporary-level2-compatibility.ts).
  **Both were re-verified against production in the 2026-07-24 preflight:**

  | Offering | Verified `CourseOffering.id` |
  | --- | --- |
  | Level 1 | `cmrqngqhn00017gcndjixzrh0` |
  | Level 2 | `cmrxk58vc0000lscnfm54bpze` |
- [lib/course/legacy-offering-compatibility-core.ts](lib/course/legacy-offering-compatibility-core.ts)
  is a pure filter with a deliberately narrow contract:
  - 0 rows → unchanged (caller still throws `NoCurrentCourseOffering`)
  - 1 row → unchanged
  - **exactly** the id-set `{Level 1, Level 2}` → the Level 1 row alone
  - **anything else** (3+ rows, unknown pair, known id + unknown third, duplicates) → unchanged,
    so the caller still throws `AmbiguousCourseOfferingError`
- [lib/course/current-offering.ts](lib/course/current-offering.ts) raised its query `take` from
  **2 → 3** so a third ACTIVE offering is *visible* to the filter and defeats the rewrite instead
  of being silently rewritten to Level 1.

### 4. No date / name / level / current-offering inference — anywhere

**Status: TEMP-WORKAROUND (rule), permanent as a design principle**

Nothing in the compatibility layer may infer an offering from:

- a name or a level number
- a `startDate` / `endDate` window — **Level 1 and Level 2 overlap in time**
- an `ActivityYear`
- status ordering or row order
- a cookie or any client-supplied "selected course"
- a "current" heuristic of any kind

Only **exact id equality** and **exact id-set equality** are permitted. Callers must still verify
that a resolved offering id exists and is ACTIVE before trusting it (fail closed).

### 5. Level 2 access limited to schedule, contacts, profile, help

**Status: TEMP-WORKAROUND**

For Level 2, every other module is hidden and/or server-blocked. The hiding is a *containment*
measure, not an authorization model — the authorization model is deferred (see below).

#### Temporary Level 2 capability launch plan (verified 2026-07-24 preflight)

The launch capability set for the Level 2 offering, expressed in the code-owned capability keys
from [lib/course/capabilities/capability-keys.ts](lib/course/capabilities/capability-keys.ts):

| Capability key | Level 2 at launch |
| --- | --- |
| `SCHEDULE` | **ENABLED** |
| `CONTACTS` | **ENABLED** |
| `ADVANCED_INSTRUCTION` | DISABLED |
| `ATTENDANCE` | DISABLED |
| `DUTIES` | DISABLED |
| `MESSAGES` | DISABLED |
| `PROGRESS_RIDING` | DISABLED |
| `RIDING` | DISABLED |
| `RIDING_HORSE_ASSIGNMENTS` | DISABLED |
| `TEACHING_PRACTICE` | DISABLED |

Notes on this table:

- It covers **all ten** capability keys in the catalog — there is no unlisted key, and therefore
  no capability whose Level 2 state is unstated.
- `EXAMS` is intentionally absent from the catalog entirely (EXAM-1: no EXAMS capability in the
  first release); it is not a deferral introduced by this launch.
- **Profile and help are not capability-gated.** They are in the launch scope but have no
  capability key, so they are not represented above and must not be assumed covered by it.
- The design invariant **missing row = DISABLED** (CAP-1) means the DISABLED rows above are the
  fail-closed default rather than an active suppression. That is the safe direction, but it also
  means a *missing* Level 2 capability row is indistinguishable from a deliberate DISABLED one —
  so the enabled pair must be asserted positively, not inferred from absence.
- Capability state is a **product gate, not an authorization boundary.** ENABLED `SCHEDULE` and
  `CONTACTS` still require the offering-scoped readers described in
  [Schedule roadmap](#schedule-roadmap) and [Contacts backlog](#contacts-backlog); DISABLED
  capabilities still require the per-module server blocks in
  [Module-isolation backlog](#module-isolation-backlog).

---

## Must remove after launch

These five are the debt the launch creates. None may be quietly kept.

### 1. Replace the temporary all-active-instructors policy with a real `Instructor ↔ CourseOffering` association

**Status: BACKLOG — P0**

The launch policy — *every active instructor may enter either course context* — is a deliberate
over-grant. It is acceptable only because instructors are staff and because each individual read
and write is still explicitly offering-scoped and server-validated. It is not acceptable as a
steady state: there is no record of who actually teaches which course, no way to remove an
instructor from one offering without deactivating their whole account, and no data to drive a
course-relevant instructor contacts directory.

Replace it with a real schema relation, populated from actual staffing.

**Removal criterion:** a populated `Instructor ↔ CourseOffering` relation exists; instructor
course access is derived from that relation; no code path grants course access purely on the basis
of `Instructor.isActive`.

### 2. Remove explicit Level 1 compatibility IDs after every caller becomes actor-aware or route-scoped

**Status: BACKLOG — P0**

Delete `LEVEL_1_COURSE_OFFERING_ID` / `LEVEL_2_COURSE_OFFERING_ID` and
`legacy-offering-compatibility-core.ts`.

**Removal criterion (all three must hold):**

- **A.** A real instructor ↔ offering relation exists and is populated.
- **B.** Every remaining `resolveCurrentCourseOffering()` call site has been migrated to an
  explicit, actor-aware or admin-selected offering, so the two-active compatibility branch is
  never taken.
- **C.** No module imports either id constant.

At that point deleting the module must break nothing. **If deletion breaks something, the
migration is incomplete** — that is the test.

### 3. Replace global `resolveCurrentCourseOffering` usage

**Status: BACKLOG — P0**

Known call sites requiring migration to an explicit offering (application code, not tests):

| Call site | Notes |
| --- | --- |
| [lib/actions/contacts.ts](lib/actions/contacts.ts) | trainee directory offering scope |
| [lib/actions/contacts-student-directory.ts](lib/actions/contacts-student-directory.ts) | injected dependency; already DI-shaped |
| [lib/course/active-trainee-directory.ts](lib/course/active-trainee-directory.ts) | injected dependency; already DI-shaped |
| [lib/actions/admin-dashboard.ts](lib/actions/admin-dashboard.ts) | admin needs an explicit course choice |
| [lib/course/create-trainee-enrollment-core.ts](lib/course/create-trainee-enrollment-core.ts) | injected dependency |
| [lib/course/capabilities/current-attendance-capability.ts](lib/course/capabilities/current-attendance-capability.ts) | documents its own singleton limitation |
| [scripts/parity-check-current-course-roster.ts](scripts/parity-check-current-course-roster.ts) | diagnostic |
| [scripts/diagnose-trainee-group-horse-history.ts](scripts/diagnose-trainee-group-horse-history.ts) | diagnostic |
| [scripts/diagnose-horse-cache-parity.ts](scripts/diagnose-horse-cache-parity.ts) | diagnostic |
| [scripts/backfill-horse-enrollment.apply.ts](scripts/backfill-horse-enrollment.apply.ts) | apply script |

Several modules already **forbid** the resolver by contract test (riding-complex template create,
attendance capability resolver adapter, `create-course-group`, `create-course-subgroup`,
`admin-course-context`). That pattern — a contract test asserting the resolver is not imported —
is the intended end state for every migrated module.

### 4. Add full course-aware authorization rather than navigation-only hiding

**Status: BACKLOG — P0**

Hiding a tab does not stop a request. Every blocked module needs **server-side** authorization
that derives the actor's course context on the server and refuses cross-course reads and writes,
independently of what the client renders.

**Removal criterion:** for each module, a server-side course check exists and a contract test
proves a Level 2 actor is refused, with navigation hiding removed from the security argument.

### 5. Remove temporary server blocks once each module is isolated

**Status: BACKLOG — P1**

The blanket Level 2 server blocks are coarse. Each is removed only when that specific module's
readers and writers are course-scoped and tested — per module, never as a batch.

---

## Schedule roadmap

`WeeklySchedule` is the deepest single-course assumption in the system, and the highest-risk area
of the launch. The order below is **mandatory**; steps are not independent.

### Committed so far

| Item | Status | Reference |
| --- | --- | --- |
| Nullable `WeeklySchedule.courseOfferingId` + index + `onDelete: Restrict` FK, plus schema contract tests | **COMMITTED — NOT APPLIED to production** | `a31c834`, [prisma/migrations/20260723120000_add_weekly_schedule_course_offering/migration.sql](prisma/migrations/20260723120000_add_weekly_schedule_course_offering/migration.sql) |
| Schedule writers require admin | **COMMITTED** | `0a3174f` |

> ⚠️ **Verified production state (2026-07-24 preflight):** migration
> `20260723120000_add_weekly_schedule_course_offering` is **NOT APPLIED**, and the column
> `weekly_schedules.courseOfferingId` **does not yet exist in production**. This is now a
> confirmed fact, not an unknown. Any code that reads or writes `courseOfferingId` will fail at
> runtime against production until the migration is applied — see
> [Production and migration safety](#production-and-migration-safety).

The migration is deliberately additive: no `NOT NULL`, no unique constraint, no cascade, **no
backfill**, no default offering, no table recreation.

### Ordered roadmap

1. **Apply the nullable `WeeklySchedule.courseOfferingId` migration to production.** — PLANNED, P0
2. **Verify the migration.** Column, index, and FK present; every existing row `NULL`; row count
   unchanged. — PLANNED, P0
3. **Explicit four-week Level 1 backfill.** Set
   `courseOfferingId = 'cmrqngqhn00017gcndjixzrh0'` (Level 1) on exactly these four verified week
   ids, **by explicit id**. Never by date range, never by "all rows", never by name pattern. —
   PLANNED, P0

   | `WeeklySchedule.id` | Target offering |
   | --- | --- |
   | `cmr6qldte001neccn7yb1cdv2` | Level 1 |
   | `cmrby8rfl0004ckcnk32cy8jp` | Level 1 |
   | `cmrow2yok000004ju4uwucyoh` | Level 1 |
   | `cmrow5wz3000004jxa6lj7kqu` | Level 1 |

   > **Week D is Level 1 only, despite overlapping Level 2 dates.** This is the concrete case that
   > proves rule 12 below is not theoretical: a correct date-based backfill is impossible here,
   > because at least one Level 1 week sits inside the Level 2 date range. The mapping above is
   > authoritative *because* it is by id; any reviewer who "corrects" it against dates will get it
   > wrong.

4. **Verify the backfill.** Exactly those four rows non-NULL, all pointing at Level 1; every other
   row still NULL; no row moved offering; row count unchanged. — PLANNED, P0
5. **Explicit offering-scoped week creation.** Week creation must take the offering as an explicit
   input. — PLANNED, P0
6. **Preserve offering during re-import.** Re-importing a week must not null out or change
   `courseOfferingId`. — PLANNED, P0
7. **Isolate all `WeeklySchedule` readers** (list below). — PLANNED, P0
8. **Permit PLANNED Level 2 schedule creation only after reader isolation is complete.** Creating
   Level 2 weeks before isolation leaks them into Level 1 surfaces. — PLANNED, P0
9. **Update the seed** so seeded weeks carry an offering.
   [prisma/seed.ts](prisma/seed.ts) currently creates `שבוע 1` with **no** `courseOfferingId`. —
   PLANNED, P1
10. **Later: `NOT NULL`** on `courseOfferingId`. Only after every row is backfilled and every
    writer sets it. — BACKLOG, P2
11. **Later: `unique(courseOfferingId, startDate)`.** Only after step 10 and after confirming no
    legitimate duplicate exists. — BACKLOG, P2
12. **Never infer offering from dates.** Level 1 and Level 2 **overlap in time**, and Week D is a
    verified counter-example: a Level 1 week whose dates fall inside the Level 2 range. Any
    date-window inference is wrong by construction, at every layer, permanently. — permanent rule

### Known global `WeeklySchedule` readers requiring isolation

All of these currently read weeks **without any offering filter**.

| Reader | Location |
| --- | --- |
| Admin weekly schedule list | [app/admin/weekly-schedule/page.tsx:12](app/admin/weekly-schedule/page.tsx#L12) |
| Admin duty-generation week list | [app/admin/schedule/page.tsx:35](app/admin/schedule/page.tsx#L35) |
| Instructor week options (`listWeeklyScheduleOptions`, includes unpublished) | [lib/actions/weekly-schedule.ts:807](lib/actions/weekly-schedule.ts#L807) |
| Trainee published week options (`listPublishedWeeklyScheduleOptions`) | [lib/actions/weekly-schedule.ts:822](lib/actions/weekly-schedule.ts#L822) |
| Trainee schedule reader | [lib/actions/student-schedule.ts:123](lib/actions/student-schedule.ts#L123) |
| Instructor schedule reader | [lib/actions/instructor-schedule.ts:92](lib/actions/instructor-schedule.ts#L92), [:164](lib/actions/instructor-schedule.ts#L164) |
| Riding overview | [lib/actions/riding-slots.ts:580](lib/actions/riding-slots.ts#L580) |
| Weekly feedback picker | [lib/actions/weekly-feedback.ts:145](lib/actions/weekly-feedback.ts#L145) |
| Schedule export | [app/api/admin/schedule/export/route.ts:74](app/api/admin/schedule/export/route.ts#L74) |

Related detail pages also read a single week by id and must be checked for cross-offering access:
[app/admin/weekly-schedule/[id]/page.tsx:18](app/admin/weekly-schedule/[id]/page.tsx#L18),
[app/admin/weekly-schedule/[id]/riding/page.tsx:18](app/admin/weekly-schedule/[id]/riding/page.tsx#L18).

Writers to keep in scope for step 5/6:
[lib/actions/weekly-schedule.ts:610](lib/actions/weekly-schedule.ts#L610),
[:621](lib/actions/weekly-schedule.ts#L621),
[:675](lib/actions/weekly-schedule.ts#L675).

---

## Module-isolation backlog

Every module below is **excluded from the Level 2 launch**. For each: the global assumption it
makes today, how the launch contains it, the desired end state, likely surfaces, and the risk of
enabling it early.

Common containment note: the **primary** containment for staged Level 2 trainees at creation time
is `Student.isActive = false`, because every known Level 1 operational reader filters on
`Student.isActive === true`. That single boolean is doing a great deal of load-bearing work, which
is exactly why the staged-activation guard exists (`cfc9a64` / `f4c0e23` / `30bd415`, all
**COMMITTED**).

### נוכחות (Attendance)

- **Current global assumption:** attendance reads the active roster and the current week without
  an offering filter; capability resolution goes through the singleton current-offering resolver
  ([lib/course/capabilities/current-attendance-capability.ts](lib/course/capabilities/current-attendance-capability.ts),
  which documents its own singleton limitation).
- **Temporary launch containment:** hidden for Level 2; Level 2 trainees inactive/not enrolled in
  the Level 1 roster; instructor writes are session-derived (no client `instructorId`).
- **Final desired behavior:** attendance scoped to `(courseOffering, week)`; capability resolved
  from the actor's own enrollment, not from a global "current" offering.
- **Likely surfaces:** [app/instructor/InstructorAttendanceSection.tsx](app/instructor/InstructorAttendanceSection.tsx), [app/student/StudentAttendanceNotice.tsx](app/student/StudentAttendanceNotice.tsx), [lib/course/capabilities/](lib/course/capabilities/), attendance actions.
- **Risk if enabled early:** Level 2 trainees appear in Level 1 attendance sheets; Level 1
  instructors mark Level 2 trainees; capability resolution throws `AmbiguousCourseOffering` or
  silently resolves to Level 1.

### תורנויות (Duties)

- **Current global assumption:** duty generation consumes the global week list and the global
  active roster; there is no offering dimension in duty generation at all.
- **Temporary launch containment:** hidden for Level 2; duty generation is admin-only and reads
  the Level 1 week list, which after backfill contains only Level 1 weeks.
- **Final desired behavior:** duty generation takes an explicit offering, generates only from that
  offering's weeks and roster.
- **Likely surfaces:** [app/admin/schedule/page.tsx](app/admin/schedule/page.tsx), [app/student/DutiesSection.tsx](app/student/DutiesSection.tsx), [app/instructor/InstructorDutiesSection.tsx](app/instructor/InstructorDutiesSection.tsx), duty actions.
- **Risk if enabled early:** duties generated across both cohorts; a Level 2 trainee assigned a
  Level 1 duty, or a Level 1 trainee's duty load silently diluted.

### רכיבות (Riding / riding complex)

- **Current global assumption:** riding slots, the riding overview, publication, and the
  move/swap flows all key off a week id with no offering dimension
  ([lib/actions/riding-slots.ts:580](lib/actions/riding-slots.ts#L580)).
- **Temporary launch containment:** hidden for Level 2; Level 2 has no weeks, so there is nothing
  to publish. Riding-complex template/publication work is **PAUSED** at its current staged state.
- **Final desired behavior:** riding structures scoped by offering-scoped week; publication state
  per offering.
- **Likely surfaces:** [lib/actions/riding-slots.ts](lib/actions/riding-slots.ts), [app/admin/weekly-schedule/[id]/riding/page.tsx](app/admin/weekly-schedule/[id]/riding/page.tsx), [app/instructor/InstructorRidingSlotsSection.tsx](app/instructor/InstructorRidingSlotsSection.tsx), [app/instructor/InstructorRidingHorsePublicationsSection.tsx](app/instructor/InstructorRidingHorsePublicationsSection.tsx).
- **Risk if enabled early:** cross-cohort pairing, publication of a Level 2 plan to Level 1
  trainees, and move/swap operating across offerings.

### סוסים (Horses)

- **Current global assumption:** horse assignment is now **enrollment-scoped** (migration +
  backfill applied to production 2026-07-19), and all three horse writers were rescoped — but the
  horse *directory* itself remains a shared global resource.
- **Temporary launch containment:** hidden for Level 2; no Level 2 enrollment-scoped horse links
  exist.
- **Final desired behavior:** enrollment-scoped assignment (already the model) plus an explicit
  decision on whether the horse pool is shared across offerings or partitioned.
- **Likely surfaces:** [app/instructor/InstructorHorsesSection.tsx](app/instructor/InstructorHorsesSection.tsx), horse writers under `lib/`, horse-cache parity diagnostics.
- **Risk if enabled early:** double-booking a physical horse across two cohorts on the same day —
  a real-world safety and logistics problem, not just a data problem.

### הודעות ועדכונים (Messages and updates)

- **Current global assumption:** messages are broadcast to the global active trainee population;
  no offering audience dimension.
- **Temporary launch containment:** hidden for Level 2; Level 2 trainees excluded from the
  broadcast audience by inactivity / non-enrollment in Level 1.
- **Final desired behavior:** message audience selected per offering (and optionally per group),
  with push notification targeting following the same audience.
- **Likely surfaces:** [app/student/StudentMessagesSection.tsx](app/student/StudentMessagesSection.tsx), [app/student/StudentMessagesSummary.tsx](app/student/StudentMessagesSummary.tsx), [app/instructor/InstructorMessagesSection.tsx](app/instructor/InstructorMessagesSection.tsx), message actions, push subscription scope.
- **Risk if enabled early:** Level 1 operational messages (and push notifications) delivered to
  Level 2 trainees, and vice versa.

### חומרי קורס (Course materials)

- **Current global assumption:** materials are a single global library visible to all trainees.
- **Temporary launch containment:** hidden for Level 2.
- **Final desired behavior:** materials owned by an offering, with an explicit "shared across
  offerings" flag if that is wanted.
- **Likely surfaces:** materials tab in [app/student/StudentClient.tsx](app/student/StudentClient.tsx) (`materials`), materials admin pages and actions.
- **Risk if enabled early:** Level 2 trainees see Level 1-specific material (wrong content, and
  potentially confusing or unsafe instructions for their level).

### משוב שבועי (Weekly feedback)

- **Current global assumption:** the feedback week picker reads weeks globally
  ([lib/actions/weekly-feedback.ts:145](lib/actions/weekly-feedback.ts#L145)); feedback rows key
  off week + trainee.
- **Temporary launch containment:** hidden for Level 2; no Level 2 weeks exist, so no Level 2
  feedback can be created.
- **Final desired behavior:** feedback scoped to offering-scoped weeks; instructor visibility
  gated by their course association.
- **Likely surfaces:** [lib/actions/weekly-feedback.ts](lib/actions/weekly-feedback.ts), [app/student/StudentWeeklyFeedbackSection.tsx](app/student/StudentWeeklyFeedbackSection.tsx).
- **Risk if enabled early:** feedback attached to the wrong cohort's week; a Level 1 instructor
  writing feedback for a Level 2 trainee they do not teach.

### התנסויות מתחילים (Beginner teaching practice)

- **Current global assumption:** teaching practice pairs trainees with beginners globally; the
  feedback-edit gate is per-instructor, not per-course.
- **Temporary launch containment:** hidden for Level 2. Note that TP feedback visibility gating
  and the TP beginner rating badge are **PAUSED / not deployed**.
- **Final desired behavior:** TP scoped to an offering, with an explicit decision on whether Level
  2 trainees participate in TP at all.
- **Likely surfaces:** [app/student/StudentTeachingPracticeSection.tsx](app/student/StudentTeachingPracticeSection.tsx), [app/instructor/InstructorTeachingPracticeSection.tsx](app/instructor/InstructorTeachingPracticeSection.tsx), TP actions.
- **Risk if enabled early:** Level 2 trainees pulled into Level 1 TP rotations, and TP records
  that cannot later be attributed to a course.

### חתימות ילדים (Child signatures)

- **Current global assumption:** the signature/tablet surface is global and is contained
  **account-wide** via `Instructor.isActive = false` (emergency containment, not per-device).
  Signed forms are legally meaningful records.
- **Temporary launch containment:** hidden and server-blocked for Level 2. **No Level 2 signature
  flow is launched.** This is the highest-sensitivity module in the system.
- **Final desired behavior:** signature capture explicitly bound to an offering and to a verified
  instructor↔offering association, with per-device containment rather than account-wide.
- **Likely surfaces:** [app/instructor/InstructorChildSignaturesSection.tsx](app/instructor/InstructorChildSignaturesSection.tsx), signed-form readers/writers, tablet surface.
- **Risk if enabled early:** a signed legal record attributed to the wrong course or wrong
  instructor. Also note the open **signed-form revocation audit gap** (3 REVOKED forms lack
  revocation audit fields, accepted legacy exception BL-EX-01) — that gap must not be widened by a
  second cohort.

### מעקב חניכים (Trainee progress tracking)

- **Current global assumption:** progress views read the global active roster and effective-dated
  group/horse history.
- **Temporary launch containment:** hidden for Level 2.
- **Final desired behavior:** progress scoped to the actor's offering; history readers already
  resolve effective-dated group/horse and would need an offering filter added.
- **Likely surfaces:** [app/instructor/InstructorTraineeProgressSection.tsx](app/instructor/InstructorTraineeProgressSection.tsx), trainee-history readers under `lib/trainee-history/`.
- **Risk if enabled early:** a Level 1 instructor browsing Level 2 trainees' history, and mixed
  cohort statistics.

### admin/global rosters

- **Current global assumption:** admin trainee and instructor lists are global by design. The
  admin dashboard resolves a single "current" offering
  ([lib/actions/admin-dashboard.ts](lib/actions/admin-dashboard.ts)).
- **Temporary launch containment:** admin remains global and **is not narrowed** for launch;
  course affiliation badges (`7b75200`, `dabf471`) and staged-activation state (`30bd415`) make
  the two cohorts visually distinguishable, and the activation guard (`f4c0e23`) prevents
  accidentally activating a staged Level 2 trainee from the general admin screen.
- **Final desired behavior:** admin explicitly *chooses* a course context; the global view remains
  available but is labelled as cross-course.
- **Likely surfaces:** [app/admin/students/](app/admin/students/), [lib/actions/admin-dashboard.ts](lib/actions/admin-dashboard.ts), [lib/actions/students.ts](lib/actions/students.ts).
- **Risk if enabled early:** an admin performs a bulk operation believing it is course-scoped when
  it is global. This is the most likely *human* failure mode of the whole launch.

---

## Contacts backlog

Contacts is one of the four launched Level 2 modules, so its gaps matter immediately.

- **Trainee directory is already enrollment-backed.** — COMMITTED.
  [lib/course/active-trainee-directory.ts](lib/course/active-trainee-directory.ts) and
  [lib/actions/contacts-student-directory.ts](lib/actions/contacts-student-directory.ts) resolve
  an offering and list trainees enrolled in it, with the offering supplied through an injected
  dependency (DI-shaped, therefore migratable without rewriting the reader).
- **Instructor directory is global.** — TEMP-WORKAROUND / BACKLOG, P1.
  Every trainee sees every instructor, regardless of course. For launch this is accepted:
  instructors are staff, the exposure is staff contact details already shared operationally, and
  it is consistent with the temporary policy that every active instructor may work in either
  course context.
- **Level 2 instructor association is missing by design during the launch window.** — BACKLOG, P1.
  There is no schema relation, so "the instructors relevant to Level 2" **cannot be computed** —
  the data to narrow the directory does not exist. This is a known gap, not an oversight, and it
  is not a launch blocker: the global directory is the intended launch behavior. It resolves when
  the permanent `Instructor ↔ CourseOffering` association lands.
- **Manager contacts remain global** and are considered safe — managers are contactable by all
  trainees by design. Re-confirm before narrowing anything.
- **Preserve existing privacy boundaries.** Contacts previously had unauthenticated exposure
  problems (`getStudentContacts` / `getInstructorContacts`), addressed via the session/actor work.
  **No Level 2 change may reintroduce a client-supplied actor id** or widen a directory's audience
  as a side effect of scoping it.

---

## Login/session backlog

- **The session stores the actor id only.** — COMMITTED design. Sessions are `jose` HS256 with a
  payload whitelist; no course context is embedded.
- **Course context is resolved per server read**, from the actor's enrollments, on every read that
  needs it. — TEMP-WORKAROUND today (via the compatibility layer), intended permanent shape.
- **Do not add selected-course cookies as authority.** — permanent rule.
  A cookie may at most be a *UI hint* for an admin. It may never be the authority for what data a
  request may read or write. Adding a course claim to the session token has the same problem
  unless it is re-verified server-side against live enrollment state.
- **Evaluate long-term multi-enrollment behavior.** — BACKLOG, P1.
  Today a trainee with two ACTIVE enrollments into ACTIVE offerings fails closed. That is correct
  and safe, but it is not a product answer.
- **Define behavior for dual ACTIVE enrollments.** — BACKLOG, P0 (decision, not code).
  Options to evaluate: forbid at write time; allow with an explicit in-app course switcher backed
  by re-verified enrollment; or designate a primary enrollment. **Until a decision exists, dual
  ACTIVE enrollment must remain a fail-closed error, not a silently-picked default.**

---

## Production and migration safety

> These are the rules most likely to cause irreversible damage if broken. Read them before
> touching production.

- **Do not deploy code expecting `courseOfferingId` before the production migration is applied.**
  **Verified 2026-07-24:** migration `20260723120000_add_weekly_schedule_course_offering` is
  **NOT APPLIED** and `weekly_schedules.courseOfferingId` **does not exist in production**. The
  migration exists in the repo (`a31c834`) only. Deploying reader/writer code in this state
  produces immediate runtime failures on every schedule query — this is the single most likely way
  to break the launch.
- **Never use `prisma migrate dev`, `prisma db push`, `prisma migrate reset`, or `prisma db seed`
  against production.** Only `prisma migrate deploy`, against a verified target, with a backup.
- **The production seed is currently destructive and needs an explicit production guard.**
  [prisma/seed.ts](prisma/seed.ts) contains **13 `deleteMany` calls** and has **no `NODE_ENV`
  check, no confirmation token, and no target-database guard**. Running it against production
  would wipe operational data. — BACKLOG, **P0**, and it is a standing hazard independent of
  Level 2.
- **Level 2 must remain `PLANNED` until all launch gates pass.** Switching the offering to
  `ACTIVE` is the single irreversible-feeling step: it activates the compatibility branch, and it
  ends the staged-activation guard's automatic protection (that guard stops blocking once the
  offering becomes ACTIVE — a floor, not a release gate).
- **Rollback requires both actions, in this order:**
  1. return the Level 2 `CourseOffering` to `PLANNED`, **and**
  2. deactivate the Level 2 trainees (`Student.isActive = false`).

  Doing only one is not a rollback: a PLANNED offering with active trainees leaves them visible in
  Level 1 surfaces, and inactive trainees under an ACTIVE offering leaves the compatibility branch
  live with no users.

---

## Deferred product decisions

These are **decisions**, not implementation tasks. Each blocks work that cannot start until it is
answered.

1. **Permanent instructor↔course relationship design.** One-to-many, many-to-many, or role-scoped
   per offering? Blocks: retiring the temporary all-active-instructors policy,
   relevant-instructor contacts, and all instructor authorization.
2. **May instructors belong to one offering, or multiple?** — **explicitly deferred.**
   The launch sidesteps this by granting every active instructor access to both contexts, which is
   *not* an answer — it is the absence of one. The permanent model must state whether an
   instructor is associated with exactly one offering (one-to-many) or several (many-to-many).
   Operationally the answer is likely "multiple", which forces a join table and changes every
   instructor-scoped query, so it must be decided before the relation is designed rather than
   after.
3. **How do administrators choose course context?** Explicit switcher, per-page selector, or
   always-global-with-labels? Blocks migration of `resolveCurrentCourseOffering` in admin paths.
4. **May an existing week ever move offerings?** Default assumption: **no**. If never, the
   `unique(courseOfferingId, startDate)` constraint and immutability enforcement become simple.
5. **When may Level 2 see each currently blocked module?** Needs a per-module release order, not a
   single "when multi-course is done" date.
6. **Trainee dual-enrollment policy.** See [Login/session backlog](#loginsession-backlog).
7. **Publication model for trainees and instructors.** Is publication per offering, per week, or
   per offering-week? Affects riding, schedule, and feedback simultaneously.

---

## Cleanup checklist

Each item: **priority · temporary/permanent · dependency · removal criterion · affected files**.

### P0 — must be resolved before or immediately around launch

- [ ] **Confirm every instructor-facing path resolves and server-validates exactly one offering**
  · P0 · temporary · depends on: the all-active-instructors policy
  · removal criterion: no instructor path takes an offering from a client value, cookie, or
  unvalidated parameter; no instructor reader returns rows from two offerings in one result set
  · files: instructor actions under [lib/actions/](lib/actions/), [app/instructor/](app/instructor/)

- [ ] **Confirm the Level 2 capability rows match the launch plan**
  · P0 · temporary · depends on: nothing
  · removal criterion: `SCHEDULE` and `CONTACTS` are positively ENABLED for the Level 2 offering,
  and the other eight keys are DISABLED or absent — asserted explicitly, never inferred from the
  missing-row default
  · files: [lib/course/capabilities/](lib/course/capabilities/), offering capability rows

> **Not tracked here:** reconciling `lib/course/actor-course-offering*.ts` with the updated
> instructor policy is owned by the **active L2-0 implementation conversation**, not by this
> backlog.

- [ ] **Apply and verify the `WeeklySchedule.courseOfferingId` migration in production**
  · P0 · permanent · depends on: production backup · **confirmed NOT APPLIED as of 2026-07-24**
  · removal criterion: column + index + FK present, all rows NULL, row count unchanged
  · files: [prisma/migrations/20260723120000_add_weekly_schedule_course_offering/migration.sql](prisma/migrations/20260723120000_add_weekly_schedule_course_offering/migration.sql)

- [ ] **Explicit four-week Level 1 backfill, by week id**
  · P0 · permanent · depends on: migration applied (week ids and target offering id are **verified
  and recorded** — see [the mapping table](#ordered-roadmap))
  · removal criterion: exactly the four listed rows non-NULL → `cmrqngqhn00017gcndjixzrh0`; all
  others NULL; Week D still Level 1 despite its Level 2-overlapping dates
  · files: backfill script (not yet written)

- [ ] **Add a production guard to the seed**
  · P0 · permanent · depends on: nothing
  · removal criterion: seed refuses to run against a non-development database without an explicit
  confirmation token
  · files: [prisma/seed.ts](prisma/seed.ts)

- [ ] **Isolate all nine global `WeeklySchedule` readers**
  · P0 · permanent · depends on: backfill verified
  · removal criterion: every reader takes an explicit offering; contract tests prove no
  cross-offering week is returned
  · files: see [the reader table](#known-global-weeklyschedule-readers-requiring-isolation)

- [ ] **Server-block every non-launch module for Level 2 (not navigation hiding alone)**
  · P0 · temporary · depends on: launch scope lock
  · removal criterion: per module, a server check exists and a test proves a Level 2 actor is
  refused
  · files: per-module actions listed in [Module-isolation backlog](#module-isolation-backlog)

- [ ] **Decide dual-ACTIVE-enrollment behavior**
  · P0 · permanent · depends on: product decision
  · removal criterion: written policy + a test asserting it
  · files: enrollment writers, course-context resolver

### P1 — soon after launch

- [ ] **Add a real `Instructor ↔ CourseOffering` relation and retire the all-active-instructors policy**
  · P1 · permanent · depends on: product decisions 1 and 2 (one vs. multiple offerings)
  · removal criterion: instructor course access is derived from the relation; no path grants
  course access purely on `Instructor.isActive`
  · files: [prisma/schema.prisma](prisma/schema.prisma), instructor authorization paths, [lib/actions/contacts.ts](lib/actions/contacts.ts)

- [ ] **Migrate every `resolveCurrentCourseOffering()` call site**
  · P1 · permanent · depends on: admin course-context decision (3)
  · removal criterion: no application module imports the resolver; contract tests forbid it, as
  already done in `admin-course-context` / `create-course-group` / riding-complex template create
  · files: see [the call-site table](#3-replace-global-resolvecurrentcourseoffering-usage)

- [ ] **Delete the legacy compatibility layer**
  · P1 · temporary · depends on: the two items above
  · removal criterion: deleting both modules breaks nothing
  · files: [lib/course/legacy-offering-compatibility-core.ts](lib/course/legacy-offering-compatibility-core.ts), [lib/course/temporary-level2-compatibility.ts](lib/course/temporary-level2-compatibility.ts), and revert `take: 3` → `take: 2` in [lib/course/current-offering.ts](lib/course/current-offering.ts)

- [ ] **Offering-scoped week creation + offering preservation on re-import**
  · P1 · permanent · depends on: backfill verified
  · removal criterion: creating a week without an explicit offering is a type error; a re-import
  test asserts `courseOfferingId` is unchanged
  · files: [lib/actions/weekly-schedule.ts](lib/actions/weekly-schedule.ts)

- [ ] **Update the seed to set an offering on seeded weeks**
  · P1 · permanent · depends on: the production seed guard
  · removal criterion: seeded weeks carry a `courseOfferingId`
  · files: [prisma/seed.ts:193](prisma/seed.ts#L193)

- [ ] **Scope the instructor contacts directory by course**
  · P1 · permanent · depends on: the instructor↔offering relation
  · removal criterion: a trainee sees only instructors associated with their offering (or a
  written decision that the global directory is intended)
  · files: [lib/actions/contacts.ts](lib/actions/contacts.ts)

- [ ] **Resume or formally close the PAUSED workstreams**
  (TP feedback visibility gating, TP beginner rating badge, riding-complex template/publication
  staging)
  · P1 · n/a · depends on: launch stabilization
  · removal criterion: each is either committed or reverted — none left staged indefinitely

### P2 — later hardening

- [ ] **`courseOfferingId` → `NOT NULL`**
  · P2 · permanent · depends on: full backfill + all writers setting it
  · removal criterion: zero NULL rows in production for a full week of normal operation
  · files: new migration

- [ ] **`unique(courseOfferingId, startDate)`**
  · P2 · permanent · depends on: `NOT NULL` + product decision 4
  · removal criterion: constraint applied with no violations
  · files: new migration

- [ ] **Course-aware authorization to replace all temporary server blocks**
  · P2 · permanent · depends on: per-module isolation
  · removal criterion: every temporary block removed, each replaced by a course-aware check
  · files: per module

- [ ] **Close the signed-form revocation audit gap (BL-EX-01)**
  · P2 · permanent · depends on: restricted diagnostic
  · removal criterion: the 3 legacy REVOKED forms are documented or repaired, and new revocations
  always write audit fields
  · files: signed-form writers

---

## Missing information (required before launch)

Recorded here so it is not mistaken for done.

1. **How instructors explicitly choose their working course context in the UI.** Every active
   instructor may enter both offerings, so a selection affordance is required. It must be a
   *request input the server validates against a real ACTIVE offering* — never an authority in
   itself, and never a cookie or client value that is trusted as given.
2. **Permanent `Instructor ↔ CourseOffering` relationship design.** Still undesigned; see
   [deferred product decisions 1 and 2](#deferred-product-decisions).
3. **The exact Level 2 trainee roster and subgroup assignment.** Who is enrolled, and into which
   subgroup, is not settled.
4. **Level 2 schedule content for 2026-08-01 through 2026-08-13.** The weeks themselves do not
   exist yet, and per roadmap step 8 they must not be created until reader isolation is complete.

**Resolved by the 2026-07-24 preflight — no longer open:**

- Production migration status → **verified NOT APPLIED** (recorded in
  [Schedule roadmap](#schedule-roadmap) and
  [Production and migration safety](#production-and-migration-safety)).
- The four Level 1 week ids → **verified and recorded** in the roadmap mapping table.
- Offering id re-verification → **both ids re-verified** against production.
- Instructor identity → no per-instructor id list is required under the updated policy.

---

## Change log

### 2026-07-24 — factual-correction pass (preflight results)

Documentation only; no code, schema, migration, test, configuration, or environment file changed.

- **Production migration state confirmed:** `20260723120000_add_weekly_schedule_course_offering`
  is **NOT APPLIED**; `weekly_schedules.courseOfferingId` does not exist in production. Recorded
  in the schedule roadmap, in production safety, and on the P0 checklist item.
- **Offering ids re-verified:** Level 1 `cmrqngqhn00017gcndjixzrh0`, Level 2
  `cmrxk58vc0000lscnfm54bpze`.
- **Level 1 week mapping verified** and recorded as an explicit id table:
  `cmr6qldte001neccn7yb1cdv2`, `cmrby8rfl0004ckcnk32cy8jp`, `cmrow2yok000004ju4uwucyoh`,
  `cmrow5wz3000004jxa6lj7kqu`.
- **Week D is Level 1 only, despite overlapping Level 2 dates** — recorded at the backfill step
  and cited as the concrete counter-example behind the never-infer-from-dates rule.
- **Instructor policy restated** against the verified offering ids: every active instructor may
  access both, no allow-list, course context explicit and server-validated, global mixed-course
  readers still forbidden.
- **Temporary Level 2 capability launch plan added:** `SCHEDULE` + `CONTACTS` ENABLED; the other
  eight catalog keys DISABLED. Verified to cover all ten keys in `capability-keys.ts`. Noted that
  profile and help are not capability-gated, and that the CAP-1 missing-row-is-DISABLED default
  means the enabled pair must be asserted positively rather than inferred from absence.
- **Missing information reduced** to four genuinely open items: instructor context selection in
  the UI, the permanent instructor↔offering relationship design, the Level 2 roster and subgroup
  assignment, and Level 2 schedule content for 2026-08-01 → 2026-08-13.
- **Reconciliation of `actor-course-offering*.ts` removed from this document's cleanup checklist**
  and explicitly handed to the active L2-0 implementation conversation. Those files were not
  edited.
- The P0 seed production-guard item is retained unchanged.

### 2026-07-24 — initial version

- Created this document. No code, schema, migration, test, configuration, or environment file was
  changed.
- Recorded the narrow Level 2 launch scope (login, schedule, contacts, profile, help) and the
  decision that everything else is isolated, hidden, or server-blocked.
- Recorded the temporary launch architecture: single-ACTIVE-enrollment trainee course context, the
  temporary instructor policy, the explicit Level 1 compatibility offering, and the no-inference
  rule.
- **Instructor policy updated the same day (supersedes the earlier draft of this document):** the
  instructor-id allow-list approach is **withdrawn**. During the urgent launch **every active
  instructor may access both the Level 1 and Level 2 course contexts**, with course context still
  explicit and server-validated, and with no authorization for global mixed-course readers. The
  permanent replacement is an `Instructor ↔ CourseOffering` association, and whether an instructor
  may belong to one or multiple offerings is recorded as a deferred product decision.
- Recorded that the compatibility modules (`temporary-level2-compatibility.ts`,
  `legacy-offering-compatibility-core.ts`, and the `take: 2 → 3` change in `current-offering.ts`)
  are **uncommitted working-tree changes**.
- Recorded that the untracked actor-aware resolver `lib/course/actor-course-offering.ts` (plus its
  pure core and tests) currently still **implements the withdrawn allow-list policy** and is
  un-wired; reconciling it with the updated instructor policy is tracked as a P0 cleanup item.
- Recorded the schedule roadmap in mandatory order, and enumerated the nine known global
  `WeeklySchedule` readers requiring isolation.
- Recorded module-isolation entries for נוכחות, תורנויות, רכיבות, סוסים, הודעות ועדכונים,
  חומרי קורס, משוב שבועי, התנסויות מתחילים, חתימות ילדים, מעקב חניכים, and admin/global rosters.
- Recorded that [prisma/seed.ts](prisma/seed.ts) is destructive (13 `deleteMany` calls) with **no
  production guard** — raised to P0.
- Recorded the two-part rollback requirement (offering → PLANNED **and** deactivate Level 2
  trainees).
- Recorded four items of missing information; after the instructor-policy update the primary
  remaining unknown is the production application status of the `WeeklySchedule.courseOfferingId`
  migration and the four Level 1 week ids needed for the backfill.
