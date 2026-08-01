"use client";

/**
 * EX-BEGINNER-EXAM-UI — the ONE compact renderer for a LIVE beginner exam row,
 * shared by the instructor and trainee exam schedules.
 *
 * ===========================================================================
 * WHY A BEGINNER ROW HAS ITS OWN RENDERER
 * ===========================================================================
 * A beginner row is a live projection of a Teaching-Practice lesson. It has NO
 * stored exam assignment, NO exam definition and NO computed timetable, so the
 * advanced renderer — which lays out waves of examinee units and the trainee
 * each one teaches — has nothing to lay out and prints an empty block. That is
 * exactly why beginner entries were invisible on both screens: they were being
 * handed to a renderer that can only draw stored assignments.
 *
 * The two callers therefore ROUTE by the contract's own `source` field, and a
 * beginner row reaches this file instead. No beginner row is passed into the
 * wave/examinee renderer, and nothing here invents an `EXAMINEE` or an
 * `INSTRUCTED_TRAINEE` to make one fit: the people on a beginner lesson are its
 * PARTICIPANTS, and that is the only word used for them.
 *
 * ===========================================================================
 * IT DECIDES NOTHING AND ASKS FOR NOTHING
 * ===========================================================================
 * READ-ONLY BY CONSTRUCTION: there is no form, no input, no button, no Server
 * Action, no Teaching-Practice writer and no edit control in this file, and none
 * may be added — Teaching Practice is the authoritative source and this is a
 * view of it. It holds no state, runs no effect, issues no request and stores
 * nothing: every value it shows was already fetched, already authorized and
 * already narrowed server-side by the committed read pipeline.
 *
 * IT PRINTS NO DATE AND NO TIME. The row's day and block window belong to the
 * card that owns this detail and are printed there exactly once. A second copy
 * here is how two disagreeing times end up on one schedule.
 *
 * ===========================================================================
 * THE COMMITTED VISIBILITY DECISION IS PRESERVED, NOT RE-TAKEN
 * ===========================================================================
 * Child names, ages, horses, equipment, notes and PARENT CONTACT detail are
 * carried to every authorized exam-access role, trainees included. That decision
 * was taken in the read layer; this file neither widens it nor quietly narrows
 * it, so nothing below is hidden, masked or truncated. `parentPhone` is rendered
 * VERBATIM and is never normalized, reformatted or turned into a dial or
 * WhatsApp target — a link built here would be a link nobody reviewed.
 *
 * The three OPERATIONAL values — the raw practice type, the lesson's own notes
 * and the lesson publication flag — are shown only when a caller explicitly asks
 * for the operational view. A trainee row does not carry them at all, so the
 * flag is the second of two independent reasons a trainee cannot be shown them.
 */
import {
  examBeginnerFormatLabel,
  type ExamBeginnerChildView,
  type ExamBeginnerDetailView,
} from "./exam-schedule-view-core";

export type {
  ExamBeginnerChildView,
  ExamBeginnerDetailView,
} from "./exam-schedule-view-core";

/**
 * The banner. It names the SOURCE — a beginner Teaching-Practice lesson — so
 * nobody reads a beginner entry as an advanced exam block.
 */
const SOURCE_LABEL = "התנסות מתחילים";
const GROUP_LABEL = "קבוצה";
const RESPONSIBLE_LABEL = "מדריך אחראי";
const PARTICIPANTS_LABEL = "מתאמנים";
const CHILDREN_LABEL = "ילדים";
const ABSENT_LABEL = "לא נוכח/ת";
const HORSE_LABEL = "סוס";
const EQUIPMENT_LABEL = "ציוד";
const CHILD_NOTES_LABEL = "הערות";
const PARENT_LABEL = "הורה";
const PHONE_LABEL = "טלפון";
const LESSON_NOTES_LABEL = "הערות שיעור";
const PUBLISHED_LABEL = "שיעור מפורסם";
const DRAFT_LABEL = "שיעור בטיוטה";

/** True iff the value is a usable display string. */
function isPresent(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** One "label: value" line, rendered only when there is a value to show. */
function DetailLine({ label, value }: { label: string; value: string | null }) {
  if (!isPresent(value)) return null;
  return (
    <p className="text-sm text-card-foreground">
      <span className="font-semibold">{label}: </span>
      {value}
    </p>
  );
}

/**
 * ONE child, compact.
 *
 * Every carried value is shown. An absent one renders no line at all rather than
 * an em dash: a blank placeholder tells a reader the value exists and is empty,
 * when in truth this lesson simply does not carry it.
 */
function BeginnerChild({ child }: { child: ExamBeginnerChildView }) {
  // Age and gender are the child's own descriptive pair and read as one line.
  const descriptors: string[] = [];
  if (typeof child.age === "number" && Number.isFinite(child.age)) {
    descriptors.push(`${child.age}`);
  }
  if (isPresent(child.gender)) descriptors.push(child.gender.trim());

  return (
    <div className="rounded-xl border border-border bg-background p-2">
      <p className="text-sm font-bold text-card-foreground">
        {isPresent(child.fullName) ? child.fullName : CHILDREN_LABEL}
        {descriptors.length > 0 && (
          <span className="font-normal text-muted-foreground"> ({descriptors.join(", ")})</span>
        )}
        {child.isAbsent && (
          <span className="font-semibold text-warning"> · {ABSENT_LABEL}</span>
        )}
      </p>
      <DetailLine label={HORSE_LABEL} value={child.horseName} />
      <DetailLine label={EQUIPMENT_LABEL} value={child.equipmentNotes} />
      <DetailLine label={CHILD_NOTES_LABEL} value={child.childNotes} />
      <DetailLine label={PARENT_LABEL} value={child.parentName} />
      {/* VERBATIM. Never normalized, never linkified. */}
      <DetailLine label={PHONE_LABEL} value={child.parentPhone} />
    </div>
  );
}

/**
 * The compact detail of ONE live beginner row.
 *
 * Renders NOTHING at all when there is no detail — a beginner row whose sibling
 * detail the read layer refused to resolve keeps its card, its banner-less time
 * and its place, and gains no invented content. An empty children list and an
 * empty participant list are likewise simply absent lines, never an empty
 * heading claiming a lesson holds nobody.
 */
export function ExamBeginnerRows({
  detail,
  showOperationalDetail = false,
}: {
  readonly detail: ExamBeginnerDetailView | null | undefined;
  /** ADMIN/INSTRUCTOR only. Never set by a trainee screen. */
  readonly showOperationalDetail?: boolean;
}) {
  if (detail === null || detail === undefined) return null;

  const formatLabel = examBeginnerFormatLabel(detail.beginnerFormat);
  // FAIL-OPEN ON THE LABEL: an unrecognised format shows the operational roles
  // the raw token rather than hiding the row. A trainee carries no raw token, so
  // an unlabelled format simply shows the source banner alone.
  const typeLabel =
    formatLabel ??
    (showOperationalDetail && isPresent(detail.practiceType) ? detail.practiceType : null);
  const participants = Array.isArray(detail.participantNames) ? detail.participantNames : [];
  const participantCount =
    typeof detail.participantCount === "number" && Number.isFinite(detail.participantCount)
      ? detail.participantCount
      : 0;
  const children = Array.isArray(detail.children) ? detail.children : [];

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3">
      {/* THE SOURCE, stated plainly. */}
      <p className="text-sm font-bold text-primary">
        {SOURCE_LABEL}
        {typeLabel !== null && ` · ${typeLabel}`}
      </p>

      <DetailLine label={GROUP_LABEL} value={detail.groupName} />
      <DetailLine label={RESPONSIBLE_LABEL} value={detail.responsibleInstructorName} />

      {/* The lesson's PARTICIPANTS. Never "נבחנים", never "חניכים מודרכים":
          a beginner lesson has neither, and printing an advanced role here
          would be a role this schedule invented. The authoritative count
          stands in when a name could not be resolved. */}
      {participantCount > 0 && (
        <DetailLine
          label={PARTICIPANTS_LABEL}
          value={participants.length > 0 ? participants.join(", ") : `${participantCount}`}
        />
      )}

      {children.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold text-card-foreground">{CHILDREN_LABEL}</p>
          {children.map((child) => (
            <BeginnerChild key={child.childKey} child={child} />
          ))}
        </div>
      )}

      {/* OPERATIONAL ONLY, and behind an explicit caller opt-in. */}
      {showOperationalDetail && (
        <>
          <DetailLine label={LESSON_NOTES_LABEL} value={detail.notes ?? null} />
          {typeof detail.isPublished === "boolean" && (
            <p className="text-xs text-muted-foreground">
              {detail.isPublished ? PUBLISHED_LABEL : DRAFT_LABEL}
            </p>
          )}
        </>
      )}
    </div>
  );
}
