"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Logo } from "@/lib/components/Logo";
import { WeekDayPicker, type WeekOption } from "@/lib/components/WeekDayPicker";
import { BottomTabs, NAV_MAX_WIDTH_CLASSNAME, type MainTabId } from "@/lib/components/BottomTabs";
import { CourseMaterialsSection } from "@/lib/components/CourseMaterialsSection";
import {
  getStudentProfile,
  logoutStudent,
  searchStudents,
  verifyStudentLogin,
  type StudentProfile,
  type StudentSearchResult,
} from "@/lib/actions/auth";
import {
  getWeeklyScheduleSelectionForTrainee,
  getDutyWeekSelectionForTrainee,
} from "@/lib/actions/weekly-schedule";
import { getUnifiedWeekOptionsForTrainee } from "@/lib/actions/unified-trainee-week-options";
import {
  listTraineeCourseOptions,
  type TraineeCourseOptionView,
} from "@/lib/actions/trainee-course-selection";
import { TraineeCourseSelector } from "@/app/student/TraineeCourseSelector";
import { filterTraineeNavEntries, isLevel2OnlyTrainee } from "@/app/student/trainee-nav-visibility";
import { hasAnyActiveEnabledCourseMaterialsOffering } from "@/lib/actions/trainee-materials-access";
import { updateOwnPrivateHorseName } from "@/lib/actions/horses";
import { ScheduleSection } from "@/app/student/ScheduleSection";
import { UnifiedScheduleSection } from "@/app/student/UnifiedScheduleSection";
import { DutiesSection } from "@/app/student/DutiesSection";
import { StudentMessagesSection } from "@/app/student/StudentMessagesSection";
import { StudentWeeklyFeedbackSection } from "@/app/student/StudentWeeklyFeedbackSection";
import { StudentPushSection } from "@/app/student/StudentPushSection";
import { StudentMessagesSummary } from "@/app/student/StudentMessagesSummary";
import { StudentAttendanceNotice } from "@/app/student/StudentAttendanceNotice";
import { StudentTeachingPracticeSection } from "@/app/student/StudentTeachingPracticeSection";
import { StudentExamsSection } from "@/app/student/StudentExamsSection";
import { ContactsSection } from "@/lib/components/ContactsSection";
import { HelpContent } from "@/lib/components/HelpContent";
import { NotificationsList, type MessagePreviewItem } from "@/lib/components/NotificationsList";
import {
  getNotificationsForStudent,
  markNotificationReadAsStudent,
  hasUnreadNotificationsForStudent,
} from "@/lib/actions/notifications";
import { getStudentMessages, type StudentMessageItem } from "@/lib/actions/messages";
import { getOpenWeeklyFeedbackForStudent } from "@/lib/actions/weekly-feedback";
import {
  formatHebrewDate,
  formatHebrewWeekday,
  getDefaultDayFilter,
  getLocalDateKey,
  parseDateKey,
} from "@/lib/dates";
import { getHorseDisplayInfo } from "@/lib/horse-info";
import { useVersionGate } from "@/lib/version-gate/useVersionGate";

const STORAGE_KEY = "duty-manager-student";

// The messages/tasks shortcut dot is a device-local "new since last opened
// the screen" indicator (like the instructor equivalent), separate from the
// real per-item readAt/completedAt state the messages screen itself still
// uses for its own badges and "סימון כנקרא"/"סימון כהושלמה" actions.
function studentMessagesLastSeenKey(studentId: string): string {
  return `duty-manager-student-messages-last-seen-${studentId}`;
}

// Student has its own 5 main bottom tabs (independent of the shared
// MAIN_TABS default, which BottomTabs still falls back to elsewhere) plus a
// "more" menu for lower-frequency sections, mirroring the instructor nav.
// Messages stays a main tab (not under "more") so new tasks/messages are
// noticeable.
const STUDENT_MAIN_TABS: { id: MainTabId; label: string }[] = [
  { id: "today", label: "היום" },
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "messages", label: "הודעות" },
  { id: "more", label: "עוד" },
];

const STUDENT_MORE_ITEMS: { id: MainTabId; label: string }[] = [
  { id: "profile", label: "פרופיל" },
  { id: "contacts", label: "אנשי קשר" },
  { id: "materials", label: "חומרי קורס" },
  { id: "teachingPractice", label: "התנסויות מתחילים" },
  // EX-TRAINEE-VIEW-MVP - the trainee "מבחנים" screen. A "עוד" menu entry, not a
  // sixth bottom tab. It is ALSO a home shortcut - see STUDENT_QUICK_ACTIONS
  // below, which reuses this exact id/label pair and goes through the SAME
  // filterTraineeNavEntries call, so a Level-2-only trainee sees it in both
  // places (it is on LEVEL2_ONLY_VISIBLE_NAV_IDS) and nobody sees it before the
  // course options resolve, exactly like every other entry here.
  { id: "exams", label: "מבחנים" },
  { id: "notifications", label: "עדכונים" },
  { id: "weeklyFeedback", label: "משוב שבועי" },
  { id: "help", label: "עזרה" },
];

const STUDENT_ALL_TABS = [...STUDENT_MAIN_TABS, ...STUDENT_MORE_ITEMS];

// Nav entries safe to show for ANY trainee before the course options have
// loaded (courseOptions === null). Until we know the trainee's eligible
// options we cannot tell a Level-2-only trainee (who must not see the course
// modules) from a Level-1-only/dual trainee, so we render only the always-safe
// entries - the utility screens plus the two modules Level 2 also enables
// (schedule, contacts). This is the SAME allow-list a Level-2-only trainee
// ends on (see LEVEL2_ONLY_VISIBLE_NAV_IDS in trainee-nav-visibility.ts), so
// the visible nav never shrinks when options resolve to Level-2-only; for a
// Level-1-only/dual trainee it simply expands to the full nav. This is
// presentation gating only - it unlocks nothing and guards nothing.
//
// Server-unlocked ids (currently just "materials", see serverUnlockedNavIds) are
// unioned onto this subset at the use site rather than being listed here: they
// are per-trainee facts the server answers, not a constant, and the union keeps
// the "nav only ever grows" property intact once the answer arrives.
const LOADING_SAFE_NAV_IDS: readonly MainTabId[] = [
  "today",
  "schedule",
  "contacts",
  "profile",
  "help",
  "more",
];

// Normalizes the existing getStudentMessages() shape for the "עדכונים"
// preview section - real per-recipient read/completed state already exists
// for students, so isUnread is a genuine true/false, never null.
function toMessagePreview(items: StudentMessageItem[]): MessagePreviewItem[] {
  return items.map((m) => ({
    id: m.recipientId,
    typeLabel: m.type === "MESSAGE" ? "הודעה" : "משימה",
    title: m.title,
    body: m.body,
    createdAt: m.createdAt,
    isUnread: m.type === "MESSAGE" ? !m.readAt : !m.completedAt,
  }));
}

// Quick-action shortcuts shown on the "today" home screen - each just calls
// setActiveTab, exactly like the instructor "today" dashboard's shortcuts and
// the "more" menu buttons already do.
const STUDENT_QUICK_ACTIONS: { id: MainTabId; label: string }[] = [
  { id: "schedule", label: 'לו"ז' },
  { id: "duties", label: "תורנויות" },
  { id: "messages", label: "הודעות ומשימות" },
  { id: "profile", label: "פרופיל" },
  { id: "contacts", label: "אנשי קשר" },
  { id: "materials", label: "חומרי קורס" },
  // Home shortcut to the existing trainee exams screen (same id/label as the
  // "עוד" menu entry above) - filtered by the SAME filterTraineeNavEntries call
  // visibleQuickActions already uses, so its visibility rules are unchanged.
  { id: "exams", label: "מבחנים" },
  // Home shortcut to the existing trainee Beginner Teaching-Practice screen
  // (same id/label as the "עוד" menu entry above, "התנסויות מתחילים") -
  // reuses the SAME setActiveTab tab-switch mechanism and goes through the
  // SAME filterTraineeNavEntries call, so it opens the existing
  // StudentTeachingPracticeSection tab and inherits its existing visibility
  // gating unchanged (teachingPractice is not on the Level-2-only allow-list,
  // exactly like the "עוד" menu entry).
  { id: "teachingPractice", label: "התנסויות מתחילים" },
];

interface StoredSession {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Shown in the schedule surfaces when the course-scoped weekly-schedule load
// REJECTS with a non-denial error. It replaces a permanent "טוען..." so the load
// always resolves visually, and it never leaks the raw server error or any PII.
const SCHEDULE_LOAD_ERROR_MESSAGE = "לא ניתן לטעון כרגע את הלו״ז. נסו לרענן את העמוד.";

// UNIFIED TRAINEE SCHEDULE - SLICE U1: resolves the single calendar day the
// "הלו״ז שלי" sub-view reads for, from the SAME date-navigation state the
// course-specific "schedule" tab already uses (dayFilter + the currently
// navigated week), never a second/conflicting date state.
// getUnifiedScheduleForTrainee always wants one specific day, never "all"
// (see its own comment), so when the week-wide "all" filter is selected this
// falls back to today (if today falls inside the currently navigated week)
// or otherwise that week's own start date - it never invents a date outside
// the week the trainee is currently looking at.
//
// selectedWeek is null both before the course-scoped week list has loaded AND,
// structurally, for the whole time a dual trainee has not yet picked an
// explicit course (the week effect deliberately issues no request and leaves
// weeks/selectedWeek empty until a course is chosen - see its own comment).
// Since a dual trainee now lands on "הלו״ז שלי" by default with no course
// picked yet (see resolveDefaultScheduleSubView), waiting on selectedWeek here
// would leave the unified view stuck on "טוען..." indefinitely. todayKey is
// always already available synchronously (see its own derivation), so it is
// the same safe fallback the home/today mount already passes directly.
export function resolveUnifiedScheduleDayKey(
  dayFilter: string | "all",
  selectedWeek: WeekOption | null,
  todayKey: string,
): string {
  if (dayFilter !== "all") return dayFilter;
  if (!selectedWeek) return todayKey;
  if (todayKey >= selectedWeek.startDate && todayKey <= selectedWeek.endDate) return todayKey;
  return selectedWeek.startDate;
}

// TEMPORARY LAUNCH HOTFIX (Level 2 group view) - PURE classifier for "the course
// the trainee is currently viewing is a Level 2 offering", read ONLY from the
// already-present, server-returned option metadata (the selected option's own
// server-provided `level`). It hardcodes no offering id and no Level 1 identity.
//
// Level 2 currently has a single relevant trainee group view, and its useful
// schedule lives under the "both" filter (a Level 2 trainee's Student.group
// compatibility fields still describe Level 1). So ANY trainee viewing Level 2 -
// dual or Level-2-only - defaults the group filter to "both" in ScheduleSection.
// Whether the mine/both controls are shown or hidden, and whether the temporary
// notice appears, is decided in ScheduleSection from this flag together with
// dual-enrollment (2+ eligible options) - see its own comment. Anything that is
// not a Level 2 selection (a Level 1 selection, nothing selected yet) returns
// false and keeps the ordinary Level 1 behaviour.
export function isSelectedOfferingLevel2(
  options: TraineeCourseOptionView[],
  selectedId: string | null,
): boolean {
  const selected = options.find((o) => o.id === selectedId);
  return selected !== undefined && selected.level === 2;
}

// UNIFIED TRAINEE SCHEDULE - default sub-view: a dual-enrolled trainee (2+
// eligible courses) opens on "הלו״ז שלי" the FIRST time this signed-in
// trainee's dual eligibility is known for the current mounted session, never
// on every render/refetch after that - so a manual "לפי קורס"/course pick, or
// a manual return to "הלו״ז שלי", survives ordinary rerenders and date/week
// navigation untouched. A single-course trainee is unaffected: dual is false,
// so this always resolves to "course", its existing default. If eligibility
// later drops below two while already showing "הלו״ז שלי", it falls back to
// "course" rather than keep showing a now-unreachable unified view; leaving
// "הלו״ז שלי" for any other reason (a real course pick) is handled by the
// existing selectedCourseOfferingId effect below, not here. Extracted as a
// pure decision so this once-per-trainee contract is unit-testable without
// mounting the client (see its own contract test).
export function resolveDefaultScheduleSubView(
  alreadyDefaultedForCurrentTrainee: boolean,
  eligibleCourseOptionsCount: number,
  currentSubView: "course" | "unified",
): "course" | "unified" {
  const dual = eligibleCourseOptionsCount >= 2;
  if (!alreadyDefaultedForCurrentTrainee) return dual ? "unified" : "course";
  if (!dual && currentSubView === "unified") return "course";
  return currentSubView;
}

// PURE selection decision for the trainee's course context, extracted from the
// options effect so its cardinality contract is unit-testable without mounting
// the client (see trainee-client-course-selection.contract.test.ts):
//  - exactly one eligible course -> auto-select that EXACT server-returned id;
//  - two or more -> NEVER auto-pick a course. Keep a still-valid prior selection,
//    otherwise fall back to "not stated" (null) so the selector is shown and no
//    schedule/contacts request runs until the trainee explicitly chooses;
//  - zero -> null.
// It draws ONLY from the server-authorized options list and hardcodes no course
// id or level; the chosen id is re-validated server-side like any other request.
export function pickTraineeCourseSelection(
  previous: string | null,
  options: TraineeCourseOptionView[],
): string | null {
  if (options.length === 1) return options[0].id;
  if (options.length > 1) {
    return previous !== null && options.some((o) => o.id === previous) ? previous : null;
  }
  return null;
}

export function StudentClient() {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSearchResult[]>([]);
  const [selected, setSelected] = useState<StudentSearchResult | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Shown on the login screen after a background refresh discovers the
  // stored account is no longer valid (deactivated/deleted) and clears it.
  const [sessionInvalidMessage, setSessionInvalidMessage] = useState<string | null>(null);
  // Small non-blocking notice for a failed background refresh (network/DB
  // hiccup) - the existing stored session is deliberately left alone here,
  // this never forces a logout.
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTabId>("today");
  // LEVEL 2 SLICE L2-DUAL - the trainee's own selectable courses, and which one
  // the SCHEDULE and CONTACTS screens are currently asking for.
  //
  // UX STATE ONLY, NEVER AUTHORITY. Both values come from the server
  // (listTraineeCourseOptions) and are re-fetched on every mount; the selected id
  // is sent as a REQUEST that each server action independently re-resolves against
  // this trainee's ACTIVE enrollments. Deliberately NOT persisted to localStorage
  // (unlike STORAGE_KEY above), a cookie or the database, so a selection can never
  // outlive a session or skip a future server check. null = "not stated", which is
  // the unchanged single-course path.
  const [courseOptions, setCourseOptions] = useState<TraineeCourseOptionView[] | null>(null);
  const [selectedCourseOfferingId, setSelectedCourseOfferingId] = useState<string | null>(null);
  // LEVEL 2 MATERIALS ENTRY POINT - the SERVER's answer to "does this trainee have
  // any active enrollment into an ACTIVE offering whose COURSE_MATERIALS is
  // ENABLED?" (hasAnyActiveEnabledCourseMaterialsOffering, which shares the
  // content reader's own scope resolver). null = not answered yet.
  //
  // NAVIGATION ONLY, NEVER AUTHORITY - exactly like courseOptions above. It
  // decides whether one menu button is offered; getStudentMaterials still
  // re-derives the whole scope server-side on every read, so a wrong `true` here
  // can only produce an empty materials screen. Deliberately NOT persisted to
  // localStorage, a cookie, React context or module state, so it can never
  // outlive a session or a mount, and a capability change is picked up on the
  // next load rather than needing a cache to be cleared.
  const [materialsEntryEnabled, setMaterialsEntryEnabled] = useState<boolean | null>(null);
  // UNIFIED TRAINEE SCHEDULE - SLICE U1: which schedule sub-view is shown -
  // the selected course (Level 1/Level 2, the unchanged default) or the
  // combined "הלו״ז שלי" cross-course view. UX STATE ONLY: rendering the
  // unified view still calls getUnifiedScheduleForTrainee with no offering
  // id, student id, or dual flag - it independently re-derives and
  // re-authorizes eligibility server-side (see its own comment).
  const [scheduleSubView, setScheduleSubView] = useState<"course" | "unified">("course");
  // UNIFIED TRAINEE SCHEDULE - default sub-view: which signed-in trainee id
  // the once-per-trainee "הלו״ז שלי" default (resolveDefaultScheduleSubView)
  // has already been applied for. Reset to null by the course-options effect
  // below whenever it restarts for a NEW trainee id, so a trainee switch
  // always gets a fresh default instead of inheriting the previous trainee's
  // choice - a ref (not state) because it is bookkeeping for that effect, not
  // something that should itself trigger a render.
  const defaultedUnifiedForTraineeIdRef = useRef<string | null>(null);
  const [weeks, setWeeks] = useState<WeekOption[] | null>(null);
  const [selectedWeekId, setSelectedWeekId] = useState<string | null>(null);
  const [dayFilter, setDayFilter] = useState<string | "all">("all");
  // Set when the course-scoped weekly-schedule load REJECTS with a non-denial
  // error (typed course-context denials already resolve to an empty selection
  // server-side, so they never reach here). It distinguishes "loaded but empty"
  // from "could not load", so the schedule shows SCHEDULE_LOAD_ERROR_MESSAGE
  // instead of a permanent "טוען...".
  const [scheduleLoadError, setScheduleLoadError] = useState(false);

  // UNIFIED TRAINEE SCHEDULE - week/day navigation: kept SEPARATE from the
  // course-specific `weeks`/`selectedWeekId` above (never repurposed), so
  // switching between "לפי קורס" and "הלו״ז שלי" always restores each side's
  // own week/day state instead of conflating them. null = not yet
  // loaded/loading; [] = loaded, genuinely empty (matches the loading/empty
  // convention `weeks` already uses). The shared `dayFilter` state above is
  // reused by both sub-views (see the schedule tab render).
  const [unifiedWeeks, setUnifiedWeeks] = useState<WeekOption[] | null>(null);
  const [unifiedSelectedWeekId, setUnifiedSelectedWeekId] = useState<string | null>(null);

  // TRAINEE DUTIES WEEK VISIBILITY FIX - duty-only week state, kept SEPARATE from
  // the schedule week state above. Duties are a Level 1 module and are not
  // course-selectable, so they must never follow selectedCourseOfferingId:
  // getDutyWeekSelectionForTrainee takes no argument and server-resolves the duty
  // offering (dual -> Level 1). Because this state is independent, switching the
  // schedule course (which only touches `weeks`/`selectedWeekId`/`dayFilter`
  // above) can never clear or replace the selected duty week.
  const [dutyWeeks, setDutyWeeks] = useState<WeekOption[] | null>(null);
  const [dutySelectedWeekId, setDutySelectedWeekId] = useState<string | null>(null);
  const [dutyDayFilter, setDutyDayFilter] = useState<string | "all">("all");

  // Drives the "עוד" tab / "עדכונים" menu-row dot - a real unread-notification
  // count, kept in sync afterward by NotificationsList's onUnreadChange.
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  // Drives the "הודעות" tab / home-shortcut dot - device-local "new since
  // last opened the screen" only (like the instructor equivalent), separate
  // from the messages screen's own real readAt/completedAt state, which it
  // keeps using for its own badges and mark-as-read/complete actions.
  const [hasNewMessages, setHasNewMessages] = useState(false);
  // PERF-1 / P2B - the home screen's SINGLE copy of this trainee's messages and
  // tasks. The effect below already fetched exactly this payload to derive the
  // "new since last opened" dot and then discarded it, while
  // StudentMessagesSummary independently fetched the very same
  // getStudentMessages(studentId) response to count unread/open items - two
  // serialized Server Action round trips for one identical payload. The items
  // are now kept here and handed down, so the summary derives its counts without
  // a request of its own.
  //
  // `null` means NOT LOADED YET (the same convention weeks/courseOptions already
  // use in this file), and is deliberately distinct from `[]` - "no messages at
  // all". The summary renders nothing for either, exactly as it did while its own
  // fetch was in flight.
  const [messageItems, setMessageItems] = useState<StudentMessageItem[] | null>(null);
  // Drives the "עוד" tab / "משוב שבועי" menu-row dot - a real DB-backed
  // signal (there's a currently-open, unanswered weekly feedback form),
  // reusing the same getOpenWeeklyFeedbackForStudent status the section
  // screen itself uses, never a separately-derived open/closed calculation.
  // Set here for the initial value (so the dot can show before the trainee
  // ever opens the tab), then kept in sync afterward by
  // StudentWeeklyFeedbackSection's onOpenChange, same dual pattern as
  // hasUnreadNotifications + NotificationsList's onUnreadChange.
  const [hasOpenWeeklyFeedback, setHasOpenWeeklyFeedback] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    hasUnreadNotificationsForStudent(session.id).then((value) => {
      if (!cancelled) setHasUnreadNotifications(value);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getOpenWeeklyFeedbackForStudent(session.id).then((result) => {
      if (!cancelled) setHasOpenWeeklyFeedback(result.status === "open");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getStudentMessages(session.id).then((items) => {
      if (cancelled) return;
      // PERF-1 / P2B - publish the payload this effect already had, so the home
      // summary needs no second fetch. The dot derivation below is unchanged.
      setMessageItems(items);
      const lastSeenRaw = window.localStorage.getItem(studentMessagesLastSeenKey(session.id));
      const lastSeen = lastSeenRaw ? new Date(lastSeenRaw).getTime() : 0;
      const hasNew = items.some((item) => new Date(item.createdAt).getTime() > lastSeen);
      setHasNewMessages(hasNew);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (!session || activeTab !== "messages") return;
    window.localStorage.setItem(studentMessagesLastSeenKey(session.id), new Date().toISOString());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasNewMessages(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, session?.id]);

  // Recomputed every minute (not just once at mount) so "today" rolls over
  // to the new local day on its own if the app is left open across
  // midnight, instead of staying frozen on the day the page first loaded.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Client version AWARENESS only (Stage 0B-1). Detects when this open bundle
  // is older than the currently-served one and offers a guarded full reload.
  // It is NOT authorization, blocks no Server Action, and never touches
  // identity/auth/localStorage. Excluded from /admin by construction (this hook
  // is mounted only in the instructor and trainee shells).
  const versionGate = useVersionGate();

  const [isEditingHorseName, setIsEditingHorseName] = useState(false);
  const [horseNameDraft, setHorseNameDraft] = useState("");
  const [horseSaveError, setHorseSaveError] = useState<string | null>(null);
  const [horseSavePending, startHorseSaveTransition] = useTransition();

  useEffect(() => {
    // One-time sync from localStorage (an external system unavailable during
    // SSR) into React state on mount - not a subscription, so this must run
    // in an effect rather than a lazy useState initializer.
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSession(JSON.parse(raw));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Refresh the profile fields from the DB whenever a session is active -
    // a long-remembered session (or one saved before a profile field like
    // subgroupNumber existed) would otherwise keep showing stale/missing data.
    if (!session) return;
    let cancelled = false;
    const studentId = session.id;

    // When the restored trainee is no longer valid/inactive/missing, route the
    // cleanup through one controlled async helper: clear the (non-authoritative)
    // trainee cookie FIRST (awaited), then tear down the local identity/UI state
    // in `finally` so teardown still happens even if the cookie deletion throws.
    // No cookie/secret detail is surfaced. This never clears the instructor
    // cookie and never mints.
    async function invalidateStudentSession() {
      try {
        await logoutStudent();
      } finally {
        if (!cancelled) {
          window.localStorage.removeItem(STORAGE_KEY);
          setSession(null);
          setSessionInvalidMessage("המשתמש/ת אינו/ה פעיל/ה יותר - יש להתחבר מחדש");
        }
      }
    }

    async function refreshStudentProfile() {
      let profile: StudentProfile | null;
      try {
        profile = await getStudentProfile(studentId);
      } catch {
        // Network/server hiccup - never log the user out for this; the
        // already-stored session keeps being used as-is.
        if (!cancelled) setRefreshError("לא ניתן היה לרענן את פרטי המשתמש כרגע");
        return;
      }
      if (cancelled) return;
      if (!profile) {
        // Account deactivated/deleted since it was last stored - the stale
        // session must not keep rendering the full app, so its cookie is
        // cleared and its local state torn down here rather than silently
        // left in place.
        try {
          await invalidateStudentSession();
        } catch {
          // The local teardown already ran in `finally`; a cookie-clear
          // failure here is non-fatal and must never surface a cookie/secret
          // detail or leave an unhandled rejection.
        }
        return;
      }
      setRefreshError(null);
      setSession(profile);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    }

    void refreshStudentProfile();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // LEVEL 2 SLICE L2-DUAL - load the trainee's own course options, then apply the
  // cardinality-correct selection: exactly one course auto-selects that server id,
  // two or more never auto-pick (see pickTraineeCourseSelection). The decision is
  // drawn ONLY from this server-authorized list (never a Level 1 constant, a
  // level, a name, a date or a stored value) and is re-validated server-side like
  // any other request.
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    // UNIFIED TRAINEE SCHEDULE - default sub-view: this effect depends only on
    // session?.id, so it restarts on a genuine trainee SWITCH, never on a
    // background profile refresh of the SAME trainee (see
    // refreshStudentProfile above, which keeps the same id). Reset the
    // once-per-trainee default tracking and clear the stale course options
    // BEFORE the fetch below, so the defaulting effect further down can never
    // read a previous trainee's option count while this new session is
    // already active - which would otherwise apply the wrong trainee's
    // dual/single default. courseOptions === null is the same "loading" state
    // already used everywhere else in this file.
    defaultedUnifiedForTraineeIdRef.current = null;
    /* eslint-disable react-hooks/set-state-in-effect */
    setScheduleSubView("course");
    setCourseOptions(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    listTraineeCourseOptions()
      .then((options) => {
        if (cancelled) return;
        setCourseOptions(options);
        setSelectedCourseOfferingId((previous) => pickTraineeCourseSelection(previous, options));
      })
      .catch(() => {
        // listTraineeCourseOptions only swallows the typed course-context denials;
        // any OTHER rejection must still end the loading state rather than leave
        // courseOptions === null forever - which would strand the schedule effect
        // on its `courseOptions === null` guard and spin "טוען..." indefinitely.
        // Fall back to no options + no selection so the schedule effect runs its
        // own empty/error path. No raw error or PII is surfaced.
        if (cancelled) return;
        setCourseOptions([]);
        setSelectedCourseOfferingId(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // LEVEL 2 MATERIALS ENTRY POINT - ask the SERVER whether the "חומרי קורס" entry
  // should be offered at all, instead of guessing it from the course level.
  //
  // Keyed on session?.id exactly like the course-options effect above, so it
  // restarts on a genuine trainee SWITCH (never on a background profile refresh
  // of the same trainee) and the previous trainee's answer is cleared BEFORE the
  // new request goes out - a stale `true` must never survive into another
  // trainee's navigation. With no session there is nothing to ask, and the state
  // stays null (= "not answered", entry not unlocked).
  //
  // A rejection resolves to `false`: the unlock is purely ADDITIVE, so a `false`
  // only means "no extra entry" - it can never remove the materials entry from a
  // Level-1-only or dual trainee, whose navigation does not consult this value at
  // all. No raw error is surfaced (this is a menu, and a failed menu hint is not
  // something to alarm a trainee with); the authoritative reader would deny the
  // read anyway if access were genuinely absent.
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setMaterialsEntryEnabled(null);
    if (!session) return;
    let cancelled = false;
    hasAnyActiveEnabledCourseMaterialsOffering()
      .then((enabled) => {
        if (cancelled) return;
        setMaterialsEntryEnabled(enabled);
      })
      .catch(() => {
        if (cancelled) return;
        setMaterialsEntryEnabled(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // UNIFIED TRAINEE SCHEDULE - default sub-view: apply the once-per-trainee
  // "הלו״ז שלי" default (resolveDefaultScheduleSubView) as soon as this
  // trainee's course options are known. Guarded on courseOptions !== null so
  // it never runs against the stale/loading state the reset above leaves in
  // place while a new trainee's options are still in flight. Runs again
  // whenever courseOptions is refetched for the SAME trainee (defensive: the
  // "already defaulted" branch is then a no-op unless dual eligibility has
  // dropped below two, in which case it safely falls back to "course").
  useEffect(() => {
    if (!session || courseOptions === null) return;
    const alreadyDefaulted = defaultedUnifiedForTraineeIdRef.current === session.id;
    defaultedUnifiedForTraineeIdRef.current = session.id;
    setScheduleSubView((prev) =>
      resolveDefaultScheduleSubView(alreadyDefaulted, courseOptions.length, prev),
    );
  }, [session, courseOptions]);

  // UNIFIED TRAINEE SCHEDULE - SLICE U1: picking a course via the existing,
  // UNCHANGED TraineeCourseSelector (whose onSelect wiring must keep writing
  // ONLY setSelectedCourseOfferingId - see the pinned dual-course-selector
  // wiring contract in trainee-client-course-selection.contract.test.ts)
  // always returns the schedule sub-view to the course-specific view,
  // without touching that wiring. A no-op when the id does not actually
  // change (e.g. the initial null -> auto-selected transition while already
  // on "course").
  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setScheduleSubView("course");
  }, [selectedCourseOfferingId]);

  useEffect(() => {
    // Waits for the course options so the very first week query already carries
    // the intended course - otherwise a dual-enrolled trainee would flash an
    // empty week list (an un-stated course is ambiguous and fails closed) before
    // the real one arrived.
    if (!session || courseOptions === null) return;

    // Two or more eligible courses but none chosen yet: wait for an explicit
    // selection. Issue NO schedule request, but never leave the loading state
    // stuck - clear to an empty (non-null) selection so no permanent "טוען..."
    // persists while the selector is shown.
    if (selectedCourseOfferingId === null && courseOptions.length > 1) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setScheduleLoadError(false);
      setWeeks([]);
      setSelectedWeekId(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    let cancelled = false;
    // LEVEL 2 SLICE S1A / L2-DUAL: the COURSE-SCOPED trainee week picker. It takes
    // no student id - the trainee is derived server-side from the signed session.
    // selectedCourseOfferingId is a REQUEST only: the server re-resolves it
    // against this trainee's own ACTIVE enrollments into ACTIVE offerings and
    // requires that resolved offering's SCHEDULE capability. Typed course-context
    // denials (no/ambiguous/unauthenticated course context, unauthorized requested
    // id, SCHEDULE not ENABLED) all resolve to an empty week list server-side; a
    // non-denial rejection is caught below so the load always leaves loading.
    getWeeklyScheduleSelectionForTrainee(selectedCourseOfferingId)
      .then((sel) => {
        if (cancelled) return;
        setScheduleLoadError(false);
        setWeeks(sel.weeks);
        setSelectedWeekId(sel.defaultWeekId);
        const defaultWeek = sel.weeks.find((w) => w.id === sel.defaultWeekId) ?? null;
        setDayFilter(getDefaultDayFilter(defaultWeek, getLocalDateKey()));
      })
      .catch(() => {
        // A non-denial rejection (an infra/Prisma error, or a resolver throwing a
        // non-denial such as IncompleteCourseOfferingError) must not leave weeks
        // === null forever. Surface a contained error and clear any stale week so
        // an older course's schedule is never shown under a newer context. The
        // `cancelled` guard drops this if a newer selection has superseded it.
        if (cancelled) return;
        setScheduleLoadError(true);
        setWeeks([]);
        setSelectedWeekId(null);
        setDayFilter("all");
      });
    return () => {
      cancelled = true;
    };
  }, [session, courseOptions, selectedCourseOfferingId]);

  // UNIFIED TRAINEE SCHEDULE - load the merged week-option list for "הלו״ז
  // שלי" whenever that sub-view is active. Deliberately does NOT depend on
  // selectedCourseOfferingId (the unified view never carries a course id -
  // see getUnifiedWeekOptionsForTrainee's own comment), so switching between
  // real courses never re-triggers this fetch. Guarded on
  // scheduleSubView === "unified" so this never fires for a single-course
  // trainee (whose sub-view can never leave "course", see
  // resolveDefaultScheduleSubView) or while "לפי קורס" is active.
  useEffect(() => {
    if (!session || courseOptions === null) return;
    if (scheduleSubView !== "unified") return;
    if (courseOptions.length < 2) return;

    let cancelled = false;
    getUnifiedWeekOptionsForTrainee()
      .then((sel) => {
        if (cancelled) return;
        setUnifiedWeeks(sel.weeks);
        // Preserve an already-explicit selection across a re-fetch unless it
        // no longer exists in the new list (e.g. a week was unpublished) -
        // only THEN fall back to the server's own default pick.
        setUnifiedSelectedWeekId((previous) => {
          if (previous !== null && sel.weeks.some((w) => w.id === previous)) {
            return previous;
          }
          return sel.defaultWeekId;
        });
      })
      .catch(() => {
        // Fails closed to an empty (non-null) list so the unified week
        // picker can never be stuck on "טוען...".
        if (cancelled) return;
        setUnifiedWeeks([]);
        setUnifiedSelectedWeekId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session, courseOptions, scheduleSubView]);

  // TRAINEE DUTIES WEEK VISIBILITY FIX - load the duty week list INDEPENDENTLY of
  // the selected schedule course. Deliberately depends only on `session`, NOT on
  // selectedCourseOfferingId, so switching the schedule/today course never
  // re-runs this and never resets dutySelectedWeekId. getDutyWeekSelectionForTrainee
  // takes no argument: the server resolves the duty offering (dual -> Level 1)
  // and requires DUTIES; a Level-2-only/denied trainee gets the uniform empty
  // selection. The `cancelled` guard means a stale run can never overwrite a
  // newer one, and the catch fails closed to an empty (non-null) list so the
  // Duties tab can never be stuck on "טוען...".
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    getDutyWeekSelectionForTrainee()
      .then((sel) => {
        if (cancelled) return;
        setDutyWeeks(sel.weeks);
        setDutySelectedWeekId(sel.defaultWeekId);
        const defaultWeek = sel.weeks.find((w) => w.id === sel.defaultWeekId) ?? null;
        setDutyDayFilter(getDefaultDayFilter(defaultWeek, getLocalDateKey()));
      })
      .catch(() => {
        if (cancelled) return;
        setDutyWeeks([]);
        setDutySelectedWeekId(null);
        setDutyDayFilter("all");
      });
    return () => {
      cancelled = true;
    };
    // PERF-1 / P2A - keyed on the stable ACTOR ID, not the session OBJECT. The
    // profile refresh above calls setSession(profile) with a freshly parsed
    // object, so its identity always changes and `[session]` re-ran this load a
    // second time per page load; the `cancelled` flag suppressed only the stale
    // state write, never the duplicate POST. This effect reads NO session
    // property - the identifier appears only in the null guard, and
    // getDutyWeekSelectionForTrainee() takes no argument - so nothing is closed
    // over that could go stale. The deliberate INDEPENDENCE documented above is
    // untouched: this still does not depend on selectedCourseOfferingId, so
    // switching the schedule course still never re-runs it or resets
    // dutySelectedWeekId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    if (selected || query.trim().length < 2) return;
    const timeout = setTimeout(() => {
      startTransition(async () => {
        const found = await searchStudents(query);
        setResults(found);
      });
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, selected]);

  const visibleResults = selected || query.trim().length < 2 ? [] : results;

  function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    setLoginError(null);
    const formData = new FormData(e.currentTarget);
    const identityNumber = String(formData.get("identityNumber"));
    startTransition(async () => {
      try {
        const result = await verifyStudentLogin(selected.id, identityNumber);
        if (!result.success || !result.student) {
          setLoginError(result.error ?? "מספר תעודת זהות שגוי");
          return;
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(result.student));
        setSession(result.student);
        setSessionInvalidMessage(null);
      } catch {
        // A thrown login action (e.g. the server cookie mint failing closed)
        // must NOT persist the trainee, set a verified session, or fall back
        // to a client-only login. Show a safe generic message without exposing
        // the underlying error, and never touch instructor state.
        setLoginError("לא ניתן להתחבר כרגע. יש לנסות שוב.");
      }
    });
  }

  async function handleSwitchStudent() {
    // Clear the (non-authoritative) trainee cookie FIRST, awaited, then run the
    // existing local teardown in `finally` so the UI/session reset still
    // happens even if the cookie deletion throws. No cookie/secret detail is
    // shown to the user; the instructor cookie is never touched.
    try {
      await logoutStudent();
    } catch {
      // intentionally ignore cookie-clear failure because the cookie is
      // non-authoritative and local teardown must continue
    } finally {
      window.localStorage.removeItem(STORAGE_KEY);
      setSession(null);
      setSelected(null);
      setQuery("");
      setActiveTab("today");
      setSessionInvalidMessage(null);
      setRefreshError(null);
    }
  }

  function startEditingHorseName() {
    if (!session) return;
    setHorseSaveError(null);
    setHorseNameDraft(session.privateHorseName ?? "");
    setIsEditingHorseName(true);
  }

  function handleSaveHorseName() {
    if (!session) return;
    setHorseSaveError(null);
    const studentId = session.id;
    const trimmed = horseNameDraft.trim();
    startHorseSaveTransition(async () => {
      const result = await updateOwnPrivateHorseName(studentId, trimmed);
      if (!result.success) {
        setHorseSaveError(result.error ?? "אירעה שגיאה");
        return;
      }
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, privateHorseName: trimmed || null };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });
      setIsEditingHorseName(false);
    });
  }

  if (!hydrated) return null;

  // On a confirmed compatibility-epoch mismatch, stop rendering the normal
  // application surface and show the approved update screen with a guarded full
  // reload. Fail-open ("ok") renders the app unchanged. This never clears
  // identity/session state and never blocks any Server Action.
  if (versionGate.status !== "ok") {
    const isReloadFailed = versionGate.status === "reload-failed";
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10 text-center">
        <Logo width={220} className="h-auto w-full max-w-[220px]" />
        <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
          <p className="mb-2 text-lg font-bold text-card-foreground">
            {isReloadFailed
              ? "לא הצלחנו לטעון את הגרסה החדשה."
              : "גרסה חדשה של המערכת זמינה."}
          </p>
          <p className="mb-4 text-base text-muted-foreground">
            {isReloadFailed
              ? "יש לסגור את המערכת ולפתוח אותה מחדש."
              : "יש לרענן את העמוד כדי להמשיך."}
          </p>
          <Button onClick={() => versionGate.reload()} className="!py-3 !text-base">
            {isReloadFailed ? "ניסיון נוסף" : "רענון המערכת"}
          </Button>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <Logo width={220} className="h-auto w-full max-w-[220px]" />
        <div className="-mt-4 text-center">
          <p className="text-lg font-bold tracking-tight text-card-foreground">Double K Top</p>
          <p className="text-sm font-semibold text-muted-foreground">קורס מדריכים · אזור חניכים</p>
        </div>
        <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="mb-1 text-2xl font-bold text-card-foreground">כניסת חניך/ה</h1>
          <p className="mb-4 text-base text-muted-foreground">
            הקלידו את שמכם ובחרו אותו מהרשימה
          </p>

          {sessionInvalidMessage && (
            <p className="mb-4 rounded-lg bg-danger-muted p-3 text-sm text-danger">
              {sessionInvalidMessage}
            </p>
          )}

          {!selected ? (
            <div className="flex flex-col gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="הקלידו שם..."
                className="rounded-xl border border-border px-4 py-3 text-base"
                autoFocus
              />
              {visibleResults.length > 0 && (
                <ul className="overflow-hidden rounded-xl border border-border">
                  {visibleResults.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(s);
                          setLoginError(null);
                        }}
                        className="w-full px-4 py-3 text-right text-base hover:bg-muted"
                      >
                        {s.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <form onSubmit={handleLogin} className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-base">
                <span className="font-medium text-card-foreground">{selected.fullName}</span>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-sm text-muted-foreground underline"
                >
                  שינוי
                </button>
              </div>
              <label className="flex flex-col gap-1 text-base">
                מספר תעודת זהות
                <input
                  name="identityNumber"
                  inputMode="numeric"
                  required
                  autoFocus
                  className="rounded-xl border border-border px-4 py-3 text-base"
                />
              </label>
              {loginError && <p className="text-base text-danger">{loginError}</p>}
              <Button type="submit" disabled={isPending} className="!py-3 !text-base">
                {isPending ? "מתחבר/ת..." : "כניסה"}
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const todayKey = getLocalDateKey(now);
  const todayWeek = weeks?.find((w) => w.startDate <= todayKey && todayKey <= w.endDate) ?? null;

  // Whether the trainee is dual-enrolled (2+ eligible options) - moved ahead
  // of `selectedWeek` below (still the SAME derivation, see viewingLevel2's
  // own comment further down) so the unified week source can be chosen
  // before that computation.
  const eligibleCourseOptions = courseOptions ?? [];
  const dualEnrolled = eligibleCourseOptions.length >= 2;

  // UNIFIED TRAINEE SCHEDULE - week/day navigation: whether the schedule
  // tab's SHARED WeekDayPicker (and resolveUnifiedScheduleDayKey below)
  // should read from the unified week list or the course-specific one.
  const isUnifiedSubViewActive = scheduleSubView === "unified" && dualEnrolled;

  // UNIFIED TRAINEE SCHEDULE - SLICE U1: the currently navigated week (by
  // id), used only to resolve a single day for the unified reader when
  // dayFilter is "all" - see resolveUnifiedScheduleDayKey. Reads from the
  // unified week list while the unified sub-view is active, and from the
  // course-specific week list otherwise - so this SAME call site keeps
  // working for both week sources without a second parameter.
  const selectedWeek =
    (isUnifiedSubViewActive ? unifiedWeeks : weeks)?.find(
      (w) => w.id === (isUnifiedSubViewActive ? unifiedSelectedWeekId : selectedWeekId),
    ) ?? null;

  // TRAINEE DUTIES WEEK VISIBILITY FIX - the Duties tab's range, derived ONLY from
  // the independent duty-week state, so it is unaffected by the schedule course
  // selection above.
  const dutySelectedWeek = dutyWeeks?.find((w) => w.id === dutySelectedWeekId) ?? null;
  const dutyRangeStart = dutySelectedWeek
    ? dutyDayFilter === "all"
      ? dutySelectedWeek.startDate
      : dutyDayFilter
    : null;
  const dutyRangeEnd = dutySelectedWeek
    ? dutyDayFilter === "all"
      ? dutySelectedWeek.endDate
      : dutyDayFilter
    : null;

  const activeTabLabel = STUDENT_ALL_TABS.find((t) => t.id === activeTab)?.label ?? "";
  const isMoreItem = STUDENT_MORE_ITEMS.some((item) => item.id === activeTab);
  const bottomActiveTab: MainTabId = isMoreItem ? "more" : activeTab;

  // TEMPORARY LAUNCH HOTFIX (Level 2 group view) - drives ScheduleSection's group
  // filter behaviour. Derived purely from the server-returned course options
  // already in state (eligibleCourseOptions, computed above): whether the
  // SELECTED course is Level 2 (see isSelectedOfferingLevel2). Level 2 ->
  // default "both"; Level-2-only (Level 2 and not dual) -> also hide the
  // group controls in ScheduleSection.
  const viewingLevel2 = isSelectedOfferingLevel2(eligibleCourseOptions, selectedCourseOfferingId);

  // TEMPORARY LAUNCH RULE (see app/student/trainee-nav-visibility.ts):
  // Level-2-only navigation is derived from the single eligible option's level.
  // Replace with server-returned effective capabilities after launch.
  //
  // For a Level-2-only trainee (exactly one eligible option, level 2) these lists
  // drop the course modules that Level 2 does not enable (duties, messages,
  // teaching practice, weekly feedback, notifications) from every nav surface -
  // the bottom tabs, the "עוד" menu and the home quick-actions - while keeping
  // schedule, contacts and the utility entries. Course MATERIALS is the one entry
  // no longer decided by level: it is unlocked per-trainee by the server
  // capability answer below (serverUnlockedNavIds), so it appears exactly when
  // COURSE_MATERIALS is really ENABLED for one of that trainee's active
  // offerings, and stays hidden when it is not. The rule reads the FULL
  // eligible options set, never the selected course, so a dual trainee is never
  // filtered and never loses a Level 1 module by selecting a Level 2 course. For
  // every non-Level-2-only trainee the three lists are returned unchanged.
  // While the course options are still loading (courseOptions === null) the
  // eligibleCourseOptions fallback [] is NOT Level-2-only, so filterTraineeNav-
  // Entries would return the FULL unfiltered nav - which then flashes and drops
  // entries the moment a Level-2-only trainee's single option arrives. Until
  // options resolve, restrict every nav surface to the always-safe subset; once
  // resolved, the existing filter runs unchanged (Level-2-only filtered,
  // Level-1-only/dual full).
  const courseOptionsLoading = courseOptions === null;

  // LEVEL 2 MATERIALS ENTRY POINT - the nav ids unlocked by a real server-side
  // capability decision rather than by the temporary level allow-list. Only a
  // resolved `true` unlocks: while the answer is null (unresolved) and on the
  // rejection path (false) the list is empty, so a Level-2-only trainee's
  // navigation is exactly what it was before this fix until the server says
  // otherwise.
  //
  // The list is ADDITIVE at every use site (see trainee-nav-visibility.ts), so it
  // can only ever ADD the materials entry for a Level-2-only trainee. A
  // Level-1-only or dual trainee's navigation is not filtered at all and is
  // therefore untouched by this value, including when the request fails.
  const serverUnlockedNavIds: readonly MainTabId[] =
    materialsEntryEnabled === true ? ["materials"] : [];

  // The loading-safe subset is unioned with the SAME unlocked ids, so the nav only
  // ever GROWS as data resolves: materials cannot appear before the server answers
  // `true`, and once it has, no later resolution (options arriving, and turning out
  // to be Level-2-only) can take the entry away again.
  const restrictToLoadingSafe = <T extends { id: MainTabId }>(entries: readonly T[]): T[] =>
    entries.filter(
      (entry) => LOADING_SAFE_NAV_IDS.includes(entry.id) || serverUnlockedNavIds.includes(entry.id),
    );

  const visibleMainTabs = courseOptionsLoading
    ? restrictToLoadingSafe(STUDENT_MAIN_TABS)
    : filterTraineeNavEntries(STUDENT_MAIN_TABS, eligibleCourseOptions, serverUnlockedNavIds);
  const moreMenuSource = STUDENT_ALL_TABS.filter((item) => item.id !== "more");
  const visibleMoreMenuItems = courseOptionsLoading
    ? restrictToLoadingSafe(moreMenuSource)
    : filterTraineeNavEntries(moreMenuSource, eligibleCourseOptions, serverUnlockedNavIds);
  const visibleQuickActions = courseOptionsLoading
    ? restrictToLoadingSafe(STUDENT_QUICK_ACTIONS)
    : filterTraineeNavEntries(STUDENT_QUICK_ACTIONS, eligibleCourseOptions, serverUnlockedNavIds);

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card px-4 py-3 shadow-sm">
        <Logo variant="mark" width={44} className="shrink-0 ring-1 ring-border" />
        <div className="min-w-0">
          <p className="truncate text-base font-extrabold tracking-tight text-primary">
            Double K Top{" "}
            <span className="text-xs font-semibold text-muted-foreground">· אזור חניכים</span>
          </p>
          <p className="truncate text-xs font-medium text-muted-foreground">{activeTabLabel}</p>
        </div>
      </header>

      {refreshError && (
        <p className="bg-warning-muted px-4 py-2 text-center text-xs text-warning">{refreshError}</p>
      )}

      <main className="flex-1 px-4 py-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {activeTab === "today" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <p className="text-sm font-semibold text-muted-foreground">שלום, {session.fullName}</p>
              <p className="text-2xl font-bold tracking-tight text-card-foreground">
                {formatHebrewWeekday(parseDateKey(todayKey))} · {formatHebrewDate(parseDateKey(todayKey))}
              </p>
            </div>

            <StudentAttendanceNotice dateKey={todayKey} />

            <div className="grid grid-cols-3 gap-2">
              {visibleQuickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => setActiveTab(action.id)}
                  className="relative rounded-xl border border-border bg-card p-3 text-center text-sm font-semibold text-card-foreground hover:bg-muted"
                >
                  {action.label}
                  {action.id === "messages" && hasNewMessages && (
                    <span
                      className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* PERF-1 / P2B - fed from this shell's single message load; it no
                longer fetches. `studentId` is gone because the fetch it existed
                for is gone - identity never reaches the summary at all now. */}
            <StudentMessagesSummary
              items={messageItems}
              onOpen={() => setActiveTab("messages")}
            />

            {/* Duties are not a Level 2 module. Hide the home duties card for a
                Level-2-only trainee, reusing the SAME rule that already filters
                the nav/quick-action entries (app/student/trainee-nav-visibility.ts)
                - no second Level 2 detection. Level-1-only and dual trainees are
                unaffected (isLevel2OnlyTrainee reads the full eligible options,
                never the selected course). */}
            {!courseOptionsLoading && !isLevel2OnlyTrainee(eligibleCourseOptions) && (
              <DutiesSection studentId={session.id} startDateKey={todayKey} endDateKey={todayKey} />
            )}

            {/* Third mount site for the course switcher (the schedule and contacts
                screens are the other two). It reuses the very same courseOptions /
                selectedCourseOfferingId / setSelectedCourseOfferingId state, so a
                pick here updates the schedule tab and vice versa, and it renders
                nothing unless this trainee has more than one eligible course. It
                sits above the home schedule block so a fresh dual trainee (no course
                selected yet) can choose one instead of only seeing an empty day. */}
            {/* UNIFIED TRAINEE SCHEDULE - SLICE U1 (UI correction): the course
                selector is visible ONLY while "לפי קורס" is the active
                sub-view - selecting "הלו״ז שלי" hides it completely rather
                than leaving it visible alongside the unified view. For a
                single-course trainee scheduleSubView never leaves "course"
                (the toggle below is never shown), so this is a no-op there. */}
            {scheduleSubView === "course" && (
              <TraineeCourseSelector
                options={courseOptions ?? []}
                selectedId={selectedCourseOfferingId}
                onSelect={setSelectedCourseOfferingId}
              />
            )}

            {/* UNIFIED TRAINEE SCHEDULE - SLICE U1: the "הלו״ז שלי" sub-view
                toggle, additive to (never replacing) the course selector
                above. Only rendered for a trainee with 2+ eligible courses -
                the SAME server-derived cardinality already computed as
                dualEnrolled above, never a client-supplied dual flag. */}
            {dualEnrolled && (
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => setScheduleSubView("course")}
                  className={`min-h-11 flex-1 rounded-full px-4 py-2 font-semibold ${
                    scheduleSubView === "course"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  לפי קורס
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleSubView("unified")}
                  className={`min-h-11 flex-1 rounded-full px-4 py-2 font-semibold ${
                    scheduleSubView === "unified"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  הלו&quot;ז שלי
                </button>
              </div>
            )}

            {scheduleSubView === "unified" && dualEnrolled ? (
              <UnifiedScheduleSection studentId={session.id} dayKey={todayKey} />
            ) : weeks === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : scheduleLoadError ? (
              <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
                {SCHEDULE_LOAD_ERROR_MESSAGE}
              </p>
            ) : todayWeek ? (
              // Part of the SCHEDULE module, so it follows the current course
              // selection made via the selector rendered just above.
              <ScheduleSection
                studentId={session.id}
                weeklyScheduleId={todayWeek.id}
                dayFilter={todayKey}
                courseOfferingId={selectedCourseOfferingId}
                viewingLevel2={viewingLevel2}
                dualEnrolled={dualEnrolled}
              />
            ) : (
              <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
                עדיין לא הועלה לו&quot;ז להיום
              </p>
            )}
          </div>
        )}

        {activeTab === "schedule" && (
          <div className="flex flex-col gap-4">
            {/* One of THREE mount sites for the course switcher (the home/today and
                contacts screens are the other two). It renders nothing unless this
                trainee genuinely has more than one eligible course. */}
            {/* UNIFIED TRAINEE SCHEDULE - SLICE U1 (UI correction): ONE
                selector row for dual trainees - the real course pills plus a
                trailing "הלו״ז שלי" pseudo-option pill, via
                TraineeCourseSelector's own extraOption slot (never a second,
                separate toggle row). The pseudo-option is never modeled as a
                CourseOffering id: it drives ONLY scheduleSubView, completely
                independent of selectedCourseOfferingId, which stays exactly
                as last chosen so returning to a real course restores it. */}
            <TraineeCourseSelector
              options={courseOptions ?? []}
              selectedId={selectedCourseOfferingId}
              onSelect={setSelectedCourseOfferingId}
              extraOption={
                dualEnrolled
                  ? {
                      label: "הלו״ז שלי",
                      isActive: scheduleSubView === "unified",
                      onSelect: () => setScheduleSubView("unified"),
                    }
                  : undefined
              }
            />

            {(isUnifiedSubViewActive ? unifiedWeeks === null : weeks === null) ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : !isUnifiedSubViewActive && scheduleLoadError ? (
              <p className="rounded-2xl border border-border bg-card p-5 text-base text-muted-foreground">
                {SCHEDULE_LOAD_ERROR_MESSAGE}
              </p>
            ) : (
              <>
                {/* The date-navigation control is SHARED (one mount, reused by
                    both sub-views) - switching to "הלו״ז שלי" never introduces a
                    second/conflicting date-picker state, and switching back
                    preserves the normal course-specific week/day selection
                    exactly as before. Its `weeks`/`selectedWeekId`/`onSelectWeek`
                    source switches between the unified and course-specific week
                    lists (never conflated - see the separate `unifiedWeeks`/
                    `unifiedSelectedWeekId` state above); `dayFilter`/`onSelectDay`
                    stay the SAME shared state for both sub-views (see
                    resolveUnifiedScheduleDayKey). */}
                <WeekDayPicker
                  weeks={(isUnifiedSubViewActive ? unifiedWeeks : weeks) ?? []}
                  selectedWeekId={isUnifiedSubViewActive ? unifiedSelectedWeekId : selectedWeekId}
                  onSelectWeek={(id) => {
                    if (isUnifiedSubViewActive) {
                      setUnifiedSelectedWeekId(id);
                      const week = unifiedWeeks?.find((w) => w.id === id) ?? null;
                      setDayFilter(getDefaultDayFilter(week, getLocalDateKey()));
                      return;
                    }
                    setSelectedWeekId(id);
                    const week = weeks?.find((w) => w.id === id) ?? null;
                    setDayFilter(getDefaultDayFilter(week, getLocalDateKey()));
                  }}
                  dayFilter={dayFilter}
                  onSelectDay={setDayFilter}
                />
                {scheduleSubView === "unified" && dualEnrolled ? (
                  <UnifiedScheduleSection
                    studentId={session.id}
                    dayKey={resolveUnifiedScheduleDayKey(dayFilter, selectedWeek, todayKey)}
                  />
                ) : (
                  // Bounded internal scroll (unlike the unbounded "today" preview
                  // above, this is the primary full-week view) - the day-group
                  // labels inside ScheduleSection are already `sticky top-0`;
                  // without this bounded box they'd resolve against the page's
                  // own scroll and collide with/hide behind the shell header's
                  // own `sticky top-0 z-20` above. Wrapping just this call (not
                  // the WeekDayPicker) gives the sticky day labels their own
                  // isolated scroll container, same fix shape already used for
                  // the instructor "לו"ז" tab.
                  <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
                    <ScheduleSection
                      studentId={session.id}
                      weeklyScheduleId={selectedWeekId}
                      dayFilter={dayFilter}
                      courseOfferingId={selectedCourseOfferingId}
                      viewingLevel2={viewingLevel2}
                      dualEnrolled={dualEnrolled}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Defense in depth: duties are hidden from every nav surface for a
            Level-2-only trainee (filterTraineeNavEntries), so this block is
            normally unreachable - but guard the CONTENT too, with the SAME rule
            the home duty card uses, so a "duties" activeTab set by any other
            path still renders nothing for a Level-2-only trainee. While course
            options are loading the eligible set is [] (not Level-2-only), which
            matches the nav's own loading-safe behaviour. The duty-week state is
            independent of the schedule course selection. */}
        {activeTab === "duties" &&
          !courseOptionsLoading &&
          !isLevel2OnlyTrainee(eligibleCourseOptions) && (
          <div className="flex flex-col gap-4">
            {dutyWeeks === null ? (
              <p className="text-base text-muted-foreground">טוען...</p>
            ) : (
              <WeekDayPicker
                weeks={dutyWeeks}
                selectedWeekId={dutySelectedWeekId}
                onSelectWeek={(id) => {
                  setDutySelectedWeekId(id);
                  const week = dutyWeeks?.find((w) => w.id === id) ?? null;
                  setDutyDayFilter(getDefaultDayFilter(week, getLocalDateKey()));
                }}
                dayFilter={dutyDayFilter}
                onSelectDay={setDutyDayFilter}
              />
            )}
            <DutiesSection
              studentId={session.id}
              startDateKey={dutyRangeStart}
              endDateKey={dutyRangeEnd}
            />
          </div>
        )}

        {activeTab === "more" && (
          <div className="flex flex-col gap-3">
            {visibleMoreMenuItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className="flex items-center justify-between rounded-2xl border border-border bg-card p-5 text-right"
              >
                <span className="flex items-center gap-1.5 text-lg font-bold text-card-foreground">
                  {item.label}
                  {item.id === "notifications" && hasUnreadNotifications && (
                    <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                  )}
                  {item.id === "weeklyFeedback" && hasOpenWeeklyFeedback && (
                    <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                  )}
                </span>
                <span className="text-muted-foreground">‹</span>
              </button>
            ))}
            <Button variant="secondary" onClick={() => void handleSwitchStudent()} className="!py-3 !text-base">
              התנתקות
            </Button>
          </div>
        )}

        {isMoreItem && (
          <button
            type="button"
            onClick={() => setActiveTab("more")}
            className="mb-3 text-sm text-muted-foreground underline"
          >
            ‹ חזרה לתפריט
          </button>
        )}

        {activeTab === "profile" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="text-sm font-semibold text-muted-foreground">שם מלא</p>
              <p className="mb-4 text-xl font-bold text-card-foreground">{session.fullName}</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">קבוצה</p>
                  <p className="text-lg font-bold text-card-foreground">{session.groupName ?? "–"}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted-foreground">תת-קבוצה</p>
                  <p className="text-lg font-bold text-card-foreground">
                    {session.subgroupNumber != null ? session.subgroupNumber : "לא הוגדר"}
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6">
              <p className="mb-2 text-sm font-semibold text-muted-foreground">סוס</p>
              {(() => {
                const horseInfo = getHorseDisplayInfo(session);
                return (
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-sm font-medium ${
                        horseInfo.badgeType === "private"
                          ? "bg-success-muted text-success"
                          : horseInfo.badgeType === "assigned"
                            ? "bg-secondary text-secondary-foreground"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {horseInfo.badgeLabel}
                    </span>
                    <span
                      className={`text-lg font-bold ${
                        horseInfo.horseName ? "text-card-foreground" : "italic text-muted-foreground"
                      }`}
                    >
                      {horseInfo.horseNameDisplay}
                    </span>
                  </div>
                );
              })()}

              {session.hasPrivateHorse &&
                (isEditingHorseName ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <input
                      value={horseNameDraft}
                      onChange={(e) => setHorseNameDraft(e.target.value)}
                      placeholder="שם הסוס הפרטי"
                      className="rounded-xl border border-border px-3 py-2.5 text-base"
                      autoFocus
                    />
                    {horseSaveError && <p className="text-sm text-danger">{horseSaveError}</p>}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="!py-2 !text-sm"
                        disabled={horseSavePending}
                        onClick={() => setIsEditingHorseName(false)}
                      >
                        ביטול
                      </Button>
                      <Button
                        type="button"
                        className="!py-2 !text-sm"
                        disabled={horseSavePending}
                        onClick={handleSaveHorseName}
                      >
                        {horseSavePending ? "שומר..." : "שמירה"}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="mt-3 !py-2 !text-sm"
                    onClick={startEditingHorseName}
                  >
                    {session.privateHorseName ? "עדכון שם הסוס" : "הוספת שם הסוס"}
                  </Button>
                ))}
            </div>
            <StudentPushSection studentId={session.id} />
            <Button variant="secondary" onClick={() => void handleSwitchStudent()} className="!py-3 !text-base">
              החלפת חניך/ה
            </Button>
          </div>
        )}

        {activeTab === "messages" && <StudentMessagesSection studentId={session.id} />}

        {activeTab === "contacts" && (
          <div className="flex flex-col gap-4">
            {/* The third mount site for the course switcher (home/today and schedule
                are the other two). */}
            <TraineeCourseSelector
              options={courseOptions ?? []}
              selectedId={selectedCourseOfferingId}
              onSelect={setSelectedCourseOfferingId}
            />
            <ContactsSection audience="trainee" traineeCourseOfferingId={selectedCourseOfferingId} />
          </div>
        )}

        {activeTab === "materials" && <CourseMaterialsSection role="student" />}

        {activeTab === "teachingPractice" && <StudentTeachingPracticeSection studentId={session.id} />}

        {/* No props at all: the exam reader AND the real Teaching-Practice
            reader it now also calls (EX-EXAM-TP-CARDS) both derive the
            trainee's identity/course server-side from the signed session. */}
        {activeTab === "exams" && <StudentExamsSection />}

        {activeTab === "weeklyFeedback" && (
          <StudentWeeklyFeedbackSection studentId={session.id} onOpenChange={setHasOpenWeeklyFeedback} />
        )}

        {activeTab === "help" && <HelpContent role="student" />}

        {activeTab === "notifications" && (
          <NotificationsList
            fetchNotifications={() => getNotificationsForStudent(session.id)}
            onMarkRead={(notificationId) => markNotificationReadAsStudent(notificationId)}
            fetchMessagePreview={() => getStudentMessages(session.id).then(toMessagePreview)}
            onOpenMessages={() => setActiveTab("messages")}
            onUnreadChange={setHasUnreadNotifications}
          />
        )}
      </main>

      <BottomTabs
        active={bottomActiveTab}
        onChange={setActiveTab}
        tabs={visibleMainTabs}
        dotTabIds={[
          ...(hasNewMessages ? (["messages"] as MainTabId[]) : []),
          ...(hasUnreadNotifications || hasOpenWeeklyFeedback ? (["more"] as MainTabId[]) : []),
        ]}
        // Matches the widened shell in app/student/page.tsx so the fixed
        // bottom nav's width tracks the content above it at every breakpoint -
        // both read from the same NAV_MAX_WIDTH_CLASSNAME source of truth.
        maxWidthClassName={NAV_MAX_WIDTH_CLASSNAME}
      />
    </div>
  );
}
