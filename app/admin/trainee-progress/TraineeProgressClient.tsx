"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getStudentRidingHistoryForAdmin } from "@/lib/actions/riding-slots";
import { getStudentTeachingPracticeFeedbackForAdmin } from "@/lib/actions/teaching-practice-feedback-history";
import {
  createStudentRidingProgressFeedbackAsAdmin,
  deleteStudentRidingProgressFeedbackAsAdmin,
  listStudentRidingProgressFeedbackForAdmin,
  updateStudentRidingProgressFeedbackAsAdmin,
} from "@/lib/actions/student-riding-progress-feedback";
import {
  createStudentLungeProgressFeedbackAsAdmin,
  deleteStudentLungeProgressFeedbackAsAdmin,
  listStudentLungeProgressFeedbackForAdmin,
  updateStudentLungeProgressFeedbackAsAdmin,
} from "@/lib/actions/student-lunge-progress-feedback";
import {
  createStudentGeneralNoteAsAdmin,
  deleteStudentGeneralNoteAsAdmin,
  getStudentGeneralNotesAsAdmin,
  updateStudentGeneralNoteAsAdmin,
} from "@/lib/actions/student-general-notes";
import {
  createStudentPresentationProgressFeedbackAsAdmin,
  deleteStudentPresentationProgressFeedbackAsAdmin,
  listStudentPresentationProgressFeedbackForAdmin,
  updateStudentPresentationProgressFeedbackAsAdmin,
} from "@/lib/actions/student-presentation-progress-feedback";
import {
  TraineeProgressDetail,
  type TraineeProgressCapabilities,
  type TraineeProgressDataSource,
} from "@/lib/components/TraineeProgressDetail";

export interface TraineeProgressStudentListItem {
  id: string;
  fullName: string;
  groupName: string | null;
  subgroupNumber: number | null;
  isActive: boolean;
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Admin never edits anything through this screen except general notes /
// riding / lunge / presentation progress feedback - every write here is the
// pre-existing *AsAdmin action, unchanged. TP feedback stays read-only for
// admin, same as before this stage (see TraineeProgressDetail.tsx's own
// comment on why upsertTeachingPracticeFeedback is only ever passed by the
// instructor caller).
const ADMIN_CAPABILITIES: TraineeProgressCapabilities = {
  isAdmin: true,
  canEditRidingFeedback: true,
  canEditTeachingPracticeFeedback: false,
  canDeleteGeneralNotes: true,
};

const ADMIN_DATA_SOURCE: TraineeProgressDataSource = {
  listGeneralNotes: getStudentGeneralNotesAsAdmin,
  createGeneralNote: (studentId, content) => createStudentGeneralNoteAsAdmin({ studentId, content }),
  updateGeneralNote: (noteId, content) => updateStudentGeneralNoteAsAdmin({ noteId, content }),
  deleteGeneralNote: deleteStudentGeneralNoteAsAdmin,

  listRidingProgress: listStudentRidingProgressFeedbackForAdmin,
  createRidingProgress: createStudentRidingProgressFeedbackAsAdmin,
  updateRidingProgress: updateStudentRidingProgressFeedbackAsAdmin,
  deleteRidingProgress: deleteStudentRidingProgressFeedbackAsAdmin,

  getRidingHistory: async (studentId) => {
    const result = await getStudentRidingHistoryForAdmin(studentId);
    return result?.rows ?? null;
  },

  getTeachingPracticeHistory: getStudentTeachingPracticeFeedbackForAdmin,

  listLungeProgress: listStudentLungeProgressFeedbackForAdmin,
  createLungeProgress: createStudentLungeProgressFeedbackAsAdmin,
  updateLungeProgress: updateStudentLungeProgressFeedbackAsAdmin,
  deleteLungeProgress: deleteStudentLungeProgressFeedbackAsAdmin,

  listPresentationProgress: listStudentPresentationProgressFeedbackForAdmin,
  createPresentationProgress: createStudentPresentationProgressFeedbackAsAdmin,
  updatePresentationProgress: updateStudentPresentationProgressFeedbackAsAdmin,
  deletePresentationProgress: deleteStudentPresentationProgressFeedbackAsAdmin,
};

export function TraineeProgressClient({
  students,
  initialStudentId = null,
}: {
  students: TraineeProgressStudentListItem[];
  // Already validated server-side (page.tsx checks it against the loaded
  // roster before passing it down) - trusted as-is here, same as any other
  // server-provided initial prop in this app.
  initialStudentId?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(initialStudentId);

  // Keeps the URL's studentId in sync with the in-page selection (deep-
  // linkable/shareable/refresh-safe), without forcing a full page reload -
  // router.replace navigates client-side, and since TraineeProgressClient
  // stays mounted at the same position across that navigation, this
  // component's own state (search text, selectedStudentId) is preserved
  // rather than reset; only the URL bar changes.
  useEffect(() => {
    if (!selectedStudentId) return;
    router.replace(`${pathname}?studentId=${selectedStudentId}`, { scroll: false });
  }, [selectedStudentId, pathname, router]);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter((s) => s.fullName.toLowerCase().includes(q));
  }, [search, students]);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === selectedStudentId) ?? null,
    [students, selectedStudentId]
  );

  function handleSelectStudent(studentId: string) {
    setSelectedStudentId(studentId);
    setIsSearchOpen(false);
    setSearch("");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        {selectedStudent && !isSearchOpen && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-card-foreground">
              חניך/ה נבחר/ת: <span className="font-semibold">{selectedStudent.fullName}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setIsSearchOpen(true);
                searchInputRef.current?.focus();
              }}
              className="text-xs font-medium text-secondary-foreground underline hover:opacity-80"
            >
              החלפת חניך/ה
            </button>
          </div>
        )}

        {/* Compact combobox - the results list is a popup that only opens
            while the input is focused/being typed into, rather than an
            always-open list permanently taking up page space. Closing on
            blur uses a short delay (rather than closing immediately) so a
            mouse click on a result still registers - onMouseDown on each
            result additionally prevents the input from blurring before that
            click's onClick fires, so mouse selection never races the close. */}
        <div className="relative">
          <label className="flex flex-col gap-1 text-sm">
            {selectedStudent ? "חיפוש/החלפת חניך/ה" : "חיפוש חניך/ה לפי שם"}
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              onBlur={() => {
                setTimeout(() => setIsSearchOpen(false), 150);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsSearchOpen(false);
                  e.currentTarget.blur();
                }
              }}
              placeholder="הקלד/י שם..."
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>

          {isSearchOpen && (
            <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg">
              {filteredStudents.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">לא נמצאו חניכים לפי החיפוש</p>
              ) : (
                filteredStudents.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleSelectStudent(s.id)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-right text-sm transition-colors ${
                      selectedStudentId === s.id
                        ? "bg-primary text-primary-foreground"
                        : "text-card-foreground hover:bg-muted"
                    }`}
                  >
                    <span>
                      {s.fullName}
                      {s.groupName ? ` · קבוצה ${s.groupName}` : ""}
                      {s.subgroupNumber != null ? ` · תת-קבוצה ${s.subgroupNumber}` : ""}
                    </span>
                    {!s.isActive && (
                      <span className="rounded-full bg-muted-foreground/20 px-2 py-0.5 text-xs">
                        לא פעיל/ה
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {selectedStudent && (
        <TraineeProgressDetail
          key={selectedStudent.id}
          student={selectedStudent}
          capabilities={ADMIN_CAPABILITIES}
          dataSource={ADMIN_DATA_SOURCE}
        />
      )}
    </div>
  );
}
