"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/lib/components/Button";
import { Modal } from "@/lib/components/Modal";
import { SuggestInput } from "@/lib/components/SuggestInput";
import { formatHebrewDate, formatHebrewDateTime, parseDateKey } from "@/lib/dates";
import { cleanScheduleTitle } from "@/lib/schedule-title";
import { groupByGroupAndSubgroup } from "@/lib/attendance-ui";
import {
  getRidingSlotComplexPlanForAdmin,
  getRidingSlotComplexPlanForInstructor,
  saveRidingSlotComplexBlockAsAdmin,
  saveRidingSlotComplexBlockAsInstructor,
  saveRidingSlotComplexStationAsAdmin,
  saveRidingSlotComplexStationAsInstructor,
  deleteRidingSlotComplexStationAsAdmin,
  deleteRidingSlotComplexStationAsInstructor,
  reorderRidingSlotComplexStationsAsAdmin,
  reorderRidingSlotComplexStationsAsInstructor,
  deleteRidingSlotComplexBlockAsAdmin,
  deleteRidingSlotComplexBlockAsInstructor,
  duplicateRidingSlotComplexBlockAsAdmin,
  duplicateRidingSlotComplexBlockAsInstructor,
  reorderRidingSlotComplexBlocksAsAdmin,
  reorderRidingSlotComplexBlocksAsInstructor,
  deleteRidingSlotComplexPlanAsAdmin,
  type RidingSlotComplexPlanForEditing,
  type RidingSlotComplexPlanRow,
  type RidingSlotComplexBlockRow,
  type RidingSlotComplexStationRow,
  type RidingSlotComplexPairRow,
  type RidingSlotComplexTraineeCandidate,
  type RidingSlotComplexSaveWarnings,
  type RidingSlotComplexBlockSaveInput,
  type RidingSlotComplexStationSaveInput,
  type RidingSlotComplexPlanActionResult,
} from "@/lib/actions/riding-slot-complex";

type InstructorOption = { id: string; fullName: string };

// Narrow discriminated actor - lets this editor be reused unchanged by both
// the admin and instructor screens. Every P5b operation has an admin/
// instructor pair with a different parameter shape (the instructor variant
// takes instructorId first) - these eight small private routing helpers are
// the only place that difference is handled, so the rest of the component
// never branches on actor type except for permission/UI gating (canEdit,
// whole-plan deletion).
export type RidingComplexPlanEditorActor = { type: "admin" } | { type: "instructor"; instructorId: string };

function readComplexPlan(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string
): Promise<RidingSlotComplexPlanForEditing | null> {
  return actor.type === "admin"
    ? getRidingSlotComplexPlanForAdmin(ridingSlotId)
    : getRidingSlotComplexPlanForInstructor(actor.instructorId, ridingSlotId);
}

function saveComplexBlock(
  actor: RidingComplexPlanEditorActor,
  input: RidingSlotComplexBlockSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? saveRidingSlotComplexBlockAsAdmin(input)
    : saveRidingSlotComplexBlockAsInstructor(actor.instructorId, input);
}

function saveComplexStation(
  actor: RidingComplexPlanEditorActor,
  input: RidingSlotComplexStationSaveInput
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? saveRidingSlotComplexStationAsAdmin(input)
    : saveRidingSlotComplexStationAsInstructor(actor.instructorId, input);
}

function deleteComplexStation(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string,
  stationId: string
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? deleteRidingSlotComplexStationAsAdmin(ridingSlotId, blockId, stationId)
    : deleteRidingSlotComplexStationAsInstructor(actor.instructorId, ridingSlotId, blockId, stationId);
}

function reorderComplexStations(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string,
  orderedStationIds: string[]
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? reorderRidingSlotComplexStationsAsAdmin(ridingSlotId, blockId, orderedStationIds)
    : reorderRidingSlotComplexStationsAsInstructor(actor.instructorId, ridingSlotId, blockId, orderedStationIds);
}

function deleteComplexBlock(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? deleteRidingSlotComplexBlockAsAdmin(ridingSlotId, blockId)
    : deleteRidingSlotComplexBlockAsInstructor(actor.instructorId, ridingSlotId, blockId);
}

function duplicateComplexBlock(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  blockId: string
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? duplicateRidingSlotComplexBlockAsAdmin(ridingSlotId, blockId)
    : duplicateRidingSlotComplexBlockAsInstructor(actor.instructorId, ridingSlotId, blockId);
}

function reorderComplexBlocks(
  actor: RidingComplexPlanEditorActor,
  ridingSlotId: string,
  orderedBlockIds: string[]
): Promise<RidingSlotComplexPlanActionResult> {
  return actor.type === "admin"
    ? reorderRidingSlotComplexBlocksAsAdmin(ridingSlotId, orderedBlockIds)
    : reorderRidingSlotComplexBlocksAsInstructor(actor.instructorId, ridingSlotId, orderedBlockIds);
}

type LoadStatus = "loading" | "loaded" | "not-found" | "error";

// Navigation state for the three-level hierarchy (time blocks -> coach
// stations -> pairs). Only one sub-view is ever open at a time; switching
// blockId/stationId always remounts the relevant editor fresh (keyed below)
// rather than reusing stale draft state across two different targets.
type EditorView =
  | { type: "blockList" }
  | { type: "editBlock"; blockId: string | null }
  | { type: "stationList"; blockId: string }
  | { type: "editStation"; blockId: string; stationId: string | null };

function timeToMinutes(t: string): number {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function blocksOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return timeToMinutes(aStart) < timeToMinutes(bEnd) && timeToMinutes(aEnd) > timeToMinutes(bStart);
}

// Every block that overlaps at least one other block in the plan - computed
// fresh on every render (cheap, block counts are small), so the badge never
// goes stale after any block save/delete/reorder.
function computeOverlappingBlockIds(blocks: RidingSlotComplexBlockRow[]): Set<string> {
  const overlapping = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      if (blocksOverlap(blocks[i].startTime, blocks[i].endTime, blocks[j].startTime, blocks[j].endTime)) {
        overlapping.add(blocks[i].id);
        overlapping.add(blocks[j].id);
      }
    }
  }
  return overlapping;
}

// Readable Hebrew labels for the warnings a station save returns -
// informational only, never rendered as errors.
function buildStationWarningMessages(w: RidingSlotComplexSaveWarnings): string[] {
  const messages: string[] = [];
  if (w.noInstructor) messages.push("לא נבחר/ה מאמן/ת לתחנה זו");
  if (w.noArena) messages.push("לא הוגדר מגרש לתחנה זו");
  if (w.zeroPairs) messages.push("לא נוספו זוגות לתחנה זו");
  if (w.pairsMissingTrainee2 > 0) messages.push(`${w.pairsMissingTrainee2} זוג/ות ללא חניכ/ה שני/ה`);
  if (w.pairsMissingHorse > 0) messages.push(`${w.pairsMissingHorse} זוג/ות ללא סוס`);
  return messages;
}

// Same incompleteness signal, but computed live from a block's own current
// station data (not tied to a save event) - every block card in the list
// shows this, not just the most-recently-saved one.
function blockStationWarningBadges(block: RidingSlotComplexBlockRow): string[] {
  const badges: string[] = [];
  const noCoach = block.stations.filter((s) => !s.instructorId).length;
  const noArena = block.stations.filter((s) => !s.arena).length;
  const zeroPairs = block.stations.filter((s) => s.pairs.length === 0).length;
  if (noCoach > 0) badges.push(`${noCoach} תחנות ללא מאמן`);
  if (noArena > 0) badges.push(`${noArena} תחנות ללא מגרש`);
  if (zeroPairs > 0) badges.push(`${zeroPairs} תחנות ללא זוגות`);
  return badges;
}

// Live per-station incompleteness badges for the station list.
function stationWarningBadges(station: RidingSlotComplexStationRow): string[] {
  const badges: string[] = [];
  if (!station.instructorId) badges.push("ללא מאמן");
  if (!station.arena) badges.push("ללא מגרש");
  if (station.pairs.length === 0) badges.push("ללא זוגות");
  const missingTrainee2 = station.pairs.filter((p) => p.trainee1Id && !p.trainee2Id).length;
  if (missingTrainee2 > 0) badges.push(`${missingTrainee2} ללא חניכ/ה שני/ה`);
  const missingHorse = station.pairs.filter((p) => p.trainee1Id && !p.horseName).length;
  if (missingHorse > 0) badges.push(`${missingHorse} ללא סוס`);
  return badges;
}

// Single-select, searchable, group/subgroup-grouped trainee picker for one
// pair slot - used to fine-tune a pair's trainees after it already exists
// (creation of a new pair goes through ContextualPairPicker below instead).
function TraineePicker({
  candidates,
  value,
  onChange,
  placeholder,
}: {
  candidates: RidingSlotComplexTraineeCandidate[];
  value: string;
  onChange: (studentId: string) => void;
  placeholder: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selected = candidates.find((c) => c.studentId === value) ?? null;
  const filtered = candidates.filter((c) => c.studentName.toLowerCase().includes(search.trim().toLowerCase()));
  const sections = groupByGroupAndSubgroup(filtered);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-right text-sm"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              <span className="font-medium text-card-foreground">{selected.studentName}</span>{" "}
              <span className="text-xs text-muted-foreground">
                {selected.groupName ? `קבוצה ${selected.groupName}` : "ללא קבוצה"}
                {selected.subgroupNumber != null ? ` / ${selected.subgroupNumber}` : ""}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <span className="shrink-0 text-muted-foreground">▾</span>
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-64 w-full min-w-[14rem] overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש חניכ/ה..."
            autoFocus
            className="w-full border-b border-border px-3 py-2 text-sm"
          />
          {value && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange("");
                setIsOpen(false);
                setSearch("");
              }}
              className="block w-full px-3 py-2 text-right text-sm text-danger hover:bg-muted"
            >
              נקה בחירה
            </button>
          )}
          {sections.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו חניכים</p>
          ) : (
            sections.map((section) => (
              <div key={section.groupName ?? "__none__"}>
                <p className="bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground">
                  {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
                </p>
                {section.subgroups.map((sub) => (
                  <div key={sub.subgroupNumber ?? "__none__"}>
                    {sub.items.map((c) => (
                      <button
                        key={c.studentId}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          onChange(c.studentId);
                          setIsOpen(false);
                          setSearch("");
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-muted ${
                          c.studentId === value ? "bg-primary/10" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">
                          {c.studentName}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {sub.subgroupNumber != null ? `תת-קבוצה ${sub.subgroupNumber}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Single-select coach dropdown for a station, with an explicit "no coach"
// option (unlike TraineePicker's clear button, this is a dedicated row so
// it's always visible even when nothing is search-filtered out).
function StationCoachPicker({
  instructors,
  value,
  onChange,
}: {
  instructors: InstructorOption[];
  value: string;
  onChange: (instructorId: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const selected = instructors.find((i) => i.id === value) ?? null;
  const filtered = instructors.filter((i) => i.fullName.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div ref={containerRef} className="relative min-w-0 w-full">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-right text-sm"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? selected.fullName : <span className="text-muted-foreground">ללא מאמן</span>}
        </span>
        <span className="shrink-0 text-muted-foreground">▾</span>
      </button>
      {isOpen && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש מאמן/ת..."
            autoFocus
            className="w-full border-b border-border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange("");
              setIsOpen(false);
              setSearch("");
            }}
            className={`block w-full px-3 py-2 text-right text-sm hover:bg-muted ${
              !value ? "bg-primary/10 font-medium text-card-foreground" : "text-muted-foreground"
            }`}
          >
            ללא מאמן
          </button>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו מאמנים</p>
          ) : (
            filtered.map((i) => (
              <button
                key={i.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(i.id);
                  setIsOpen(false);
                  setSearch("");
                }}
                className={`block w-full px-3 py-2 text-right text-sm hover:bg-muted ${
                  i.id === value ? "bg-primary/10 font-medium text-card-foreground" : ""
                }`}
              >
                {i.fullName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface PairDraft {
  key: number;
  trainee1Id: string;
  trainee2Id: string;
  horseName: string;
  note: string;
}

let pairDraftKeySeq = 0;
function newPairDraftFrom(trainee1Id: string, trainee2Id: string, horseName: string): PairDraft {
  pairDraftKeySeq += 1;
  return { key: pairDraftKeySeq, trainee1Id, trainee2Id, horseName, note: "" };
}
function pairDraftFromRow(row: RidingSlotComplexPairRow): PairDraft {
  pairDraftKeySeq += 1;
  return {
    key: pairDraftKeySeq,
    trainee1Id: row.trainee1Id ?? "",
    trainee2Id: row.trainee2Id ?? "",
    horseName: row.horseName ?? "",
    note: row.note ?? "",
  };
}

// Compact per-station summary of every OTHER station already in the block -
// exactly the data computeStationClientIssues needs to mirror the server's
// cross-station hard-validation (trainee/horse/instructor duplicates,
// deliberately NOT arena - same-block arena reuse across coaches is allowed).
interface OtherStationSummary {
  instructorId: string | null;
  traineeIds: string[];
  horseKeys: string[];
}

function summarizeOtherStations(
  block: RidingSlotComplexBlockRow,
  excludeStationId: string | null
): OtherStationSummary[] {
  return block.stations
    .filter((s) => s.id !== excludeStationId)
    .map((s) => ({
      instructorId: s.instructorId,
      traineeIds: s.pairs.flatMap((p) => [p.trainee1Id, p.trainee2Id].filter((id): id is string => Boolean(id))),
      horseKeys: s.pairs.map((p) => p.horseName?.trim().toLowerCase()).filter((h): h is string => Boolean(h)),
    }));
}

// Client-side pre-checks only - mirrors the exact P5b hard-validation rules
// (same Hebrew text) so a mistake is caught before a round trip, but the
// server remains the sole authority; these never block typing/selecting,
// only the station Save button. Arena duplicates are intentionally never
// checked here (explicitly allowed across stations in the same block).
function computeStationClientIssues(
  pairs: PairDraft[],
  instructorId: string | null,
  otherStations: OtherStationSummary[]
): string[] {
  const issues: string[] = [];

  const hasMalformed = pairs.some((p) => !p.trainee1Id && (p.trainee2Id || p.horseName.trim() || p.note.trim()));
  if (hasMalformed) {
    issues.push("יש לבחור חניכ/ה ראשונ/ה לכל זוג שמכיל פרטים (סוס, הערה או חניכ/ה שני/ה)");
  }

  const meaningfulPairs = pairs.filter((p) => p.trainee1Id);

  if (meaningfulPairs.some((p) => p.trainee2Id && p.trainee2Id === p.trainee1Id)) {
    issues.push("לא ניתן לבחור את אותו/ה חניכ/ה פעמיים באותו זוג");
  }

  const traineeCounts = new Map<string, number>();
  for (const p of meaningfulPairs) {
    traineeCounts.set(p.trainee1Id, (traineeCounts.get(p.trainee1Id) ?? 0) + 1);
    if (p.trainee2Id) traineeCounts.set(p.trainee2Id, (traineeCounts.get(p.trainee2Id) ?? 0) + 1);
  }
  const otherTraineeIds = new Set(otherStations.flatMap((s) => s.traineeIds));
  const hasTraineeDuplicate =
    Array.from(traineeCounts.values()).some((c) => c > 1) ||
    Array.from(traineeCounts.keys()).some((id) => otherTraineeIds.has(id));
  if (hasTraineeDuplicate) {
    issues.push("אותו/ה חניכ/ה נבחר/ה יותר מפעם אחת באותו טווח שעות");
  }

  const horseCounts = new Map<string, number>();
  for (const p of meaningfulPairs) {
    const h = p.horseName.trim();
    if (!h) continue;
    horseCounts.set(h.toLowerCase(), (horseCounts.get(h.toLowerCase()) ?? 0) + 1);
  }
  const otherHorseKeys = new Set(otherStations.flatMap((s) => s.horseKeys));
  const hasHorseDuplicate =
    Array.from(horseCounts.values()).some((c) => c > 1) ||
    Array.from(horseCounts.keys()).some((k) => otherHorseKeys.has(k));
  if (hasHorseDuplicate) {
    issues.push("אותו שם סוס נבחר יותר מפעם אחת באותו טווח שעות");
  }

  if (instructorId && otherStations.some((s) => s.instructorId === instructorId)) {
    issues.push("אותו/ה מאמן/ת משובצ/ת ליותר מתחנה אחת באותו טווח שעות");
  }

  return issues;
}

// Trainees already paired somewhere in this block - every OTHER persisted
// station's pairs, plus the CURRENT station's own local (possibly unsaved)
// draft pairs. Deliberately excludes the picker's own in-progress selection
// (that state lives separately in ContextualPairPicker), so a candidate just
// tapped in the picker reads as "selected", never as "already used".
function computeUsedTraineeIds(
  block: RidingSlotComplexBlockRow,
  currentStationId: string | null,
  currentDraftPairs: PairDraft[]
): Set<string> {
  const used = new Set<string>();
  for (const station of block.stations) {
    if (station.id === currentStationId) continue;
    for (const pair of station.pairs) {
      if (pair.trainee1Id) used.add(pair.trainee1Id);
      if (pair.trainee2Id) used.add(pair.trainee2Id);
    }
  }
  for (const pair of currentDraftPairs) {
    if (pair.trainee1Id) used.add(pair.trainee1Id);
    if (pair.trainee2Id) used.add(pair.trainee2Id);
  }
  return used;
}

// Trainees already paired somewhere in an EARLIER time block of the same
// plan (by block.sortOrder, the server-guaranteed ordering - never array
// position on its own and never compared across unrelated RidingSlots).
// Informational only: unlike computeUsedTraineeIds this never disables
// selection and is not treated as a validation error - repeated scheduling
// across blocks is allowed and common (e.g. a trainee riding twice).
function computeEarlierAssignedTraineeIds(earlierBlocks: RidingSlotComplexBlockRow[]): Set<string> {
  const ids = new Set<string>();
  for (const block of earlierBlocks) {
    for (const station of block.stations) {
      for (const pair of station.pairs) {
        if (pair.trainee1Id) ids.add(pair.trainee1Id);
        if (pair.trainee2Id) ids.add(pair.trainee2Id);
      }
    }
  }
  return ids;
}

function candidateMatchesStationCoach(
  candidate: RidingSlotComplexTraineeCandidate,
  stationInstructorName: string | null
): boolean {
  if (!stationInstructorName || !candidate.responsibleInstructorNames) return false;
  return candidate.responsibleInstructorNames.includes(stationInstructorName);
}

// Applied once, at pair-creation time only, never re-applied afterward and
// never written back to Student/RidingLessonNote: one trainee -> use their
// assigned horse; two trainees with the same horse (case-insensitive) -> use
// the first-selected trainee's capitalization; otherwise leave blank.
function computePrefillHorse(
  candidate1: RidingSlotComplexTraineeCandidate | null,
  candidate2: RidingSlotComplexTraineeCandidate | null
): string {
  if (candidate1 && !candidate2) {
    return candidate1.horseName ?? "";
  }
  if (candidate1 && candidate2) {
    const h1 = candidate1.horseName?.trim();
    const h2 = candidate2.horseName?.trim();
    if (h1 && h2 && h1.toLowerCase() === h2.toLowerCase()) {
      return candidate1.horseName ?? "";
    }
  }
  return "";
}

// Read-only context shown under a pair's trainee selectors - each trainee's
// assigned horse and responsible coach, derived by studentId from the
// already-loaded candidate list. Never persisted; explains why a pair's
// horse field may have been left blank (different horses / no assignment).
function PairContextInfo({
  pair,
  candidates,
}: {
  pair: PairDraft;
  candidates: RidingSlotComplexTraineeCandidate[];
}) {
  const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id) ?? null;
  const trainee2 = pair.trainee2Id ? (candidates.find((c) => c.studentId === pair.trainee2Id) ?? null) : null;
  if (!trainee1) return null;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 p-2 text-[11px] text-muted-foreground">
      <p className="truncate">
        סוס מוקצה ל{trainee1.studentName}: {trainee1.horseName ? trainee1.horseNameDisplay : "לא הוגדר סוס"}
        {" · "}מאמן/ת: {trainee1.responsibleInstructorNames ?? "לא הוגדר מאמן"}
      </p>
      {trainee2 && (
        <p className="truncate">
          סוס מוקצה ל{trainee2.studentName}: {trainee2.horseName ? trainee2.horseNameDisplay : "לא הוגדר סוס"}
          {" · "}מאמן/ת: {trainee2.responsibleInstructorNames ?? "לא הוגדר מאמן"}
        </p>
      )}
    </div>
  );
}

// Contextual candidate picker for creating ONE new pair in the currently
// open station. Rendered as an inline sub-view inside the station editor
// (never a nested modal). Already-used trainees are disabled for selection,
// not just badged; a coach-match badge is informational only (no sorting,
// no hard restriction) - matches must appear in their normal group/subgroup
// position.
function ContextualPairPicker({
  candidates,
  usedTraineeIds,
  earlierAssignedTraineeIds,
  stationInstructorName,
  onConfirm,
  onCancel,
}: {
  candidates: RidingSlotComplexTraineeCandidate[];
  usedTraineeIds: Set<string>;
  // Empty set when the current block is the plan's first block (by
  // sortOrder) - the "not yet scheduled" summary below is only rendered
  // when there is at least one earlier block, so it never claims "0 trainees
  // scheduled" clutter on the very first block.
  earlierAssignedTraineeIds: { ids: Set<string>; hasEarlierBlocks: boolean };
  stationInstructorName: string | null;
  onConfirm: (trainee1Id: string, trainee2Id: string | null, prefillHorse: string) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const confirmedRef = useRef(false);

  function toggle(studentId: string) {
    setSelectedIds((current) => {
      if (current.includes(studentId)) return current.filter((id) => id !== studentId);
      if (current.length >= 2) return current;
      return [...current, studentId];
    });
  }

  function handleConfirm() {
    if (selectedIds.length === 0 || confirmedRef.current) return;
    confirmedRef.current = true;
    const [id1, id2] = selectedIds;
    const c1 = candidates.find((c) => c.studentId === id1) ?? null;
    const c2 = id2 ? (candidates.find((c) => c.studentId === id2) ?? null) : null;
    onConfirm(id1, id2 ?? null, computePrefillHorse(c1, c2));
  }

  const filtered = candidates.filter((c) => c.studentName.toLowerCase().includes(search.trim().toLowerCase()));
  const sections = groupByGroupAndSubgroup(filtered);

  const notYetScheduledCount = earlierAssignedTraineeIds.hasEarlierBlocks
    ? candidates.filter((c) => !earlierAssignedTraineeIds.ids.has(c.studentId)).length
    : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <p className="text-sm font-semibold text-card-foreground">בחירת חניכים לזוג</p>
        <span className="text-xs text-muted-foreground">נבחרו {selectedIds.length} מתוך 2</span>
      </div>
      {notYetScheduledCount !== null && (
        <p className="shrink-0 text-xs text-muted-foreground">טרם שובצו קודם: {notYetScheduledCount}</p>
      )}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="חיפוש חניכ/ה..."
        className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm"
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
        {sections.length === 0 ? (
          <p className="text-sm text-muted-foreground">לא נמצאו חניכים</p>
        ) : (
          sections.map((section) => (
            <div key={section.groupName ?? "__none__"} className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                {section.groupName ? `קבוצה ${section.groupName}` : "ללא קבוצה"}
              </p>
              {section.subgroups.map((sub) => (
                <div key={sub.subgroupNumber ?? "__none__"} className="flex flex-col gap-1.5">
                  {sub.subgroupNumber != null && (
                    <p className="text-[11px] text-muted-foreground">תת-קבוצה {sub.subgroupNumber}</p>
                  )}
                  {sub.items.map((c) => {
                    const isUsed = usedTraineeIds.has(c.studentId);
                    const isSelected = selectedIds.includes(c.studentId);
                    const atCap = !isSelected && selectedIds.length >= 2;
                    const disableTap = isUsed || atCap;
                    const isCoachMatch = candidateMatchesStationCoach(c, stationInstructorName);
                    // Non-blocking - never disables the trainee, never
                    // treated as a validation issue, does not prevent
                    // repeated scheduling across blocks.
                    const isScheduledEarlier = earlierAssignedTraineeIds.ids.has(c.studentId);
                    return (
                      <button
                        key={c.studentId}
                        type="button"
                        disabled={disableTap}
                        onClick={() => toggle(c.studentId)}
                        className={`flex w-full flex-col gap-1 rounded-lg border p-2.5 text-right disabled:cursor-not-allowed ${
                          isSelected ? "border-primary bg-primary/10" : "border-border bg-card"
                        } ${disableTap ? "opacity-50" : "hover:bg-muted"}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-card-foreground">
                            {c.studentName}
                          </span>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={disableTap}
                            readOnly
                            className="h-4 w-4 shrink-0"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                          <span>
                            {c.groupName ? `קבוצה ${c.groupName}` : "ללא קבוצה"}
                            {c.subgroupNumber != null ? ` / ${c.subgroupNumber}` : ""}
                          </span>
                          <span>· סוס: {c.horseName ? c.horseNameDisplay : "לא הוגדר סוס"}</span>
                          <span>· מאמן/ת: {c.responsibleInstructorNames ?? "לא הוגדר מאמן"}</span>
                        </div>
                        {(isUsed || isCoachMatch || isScheduledEarlier) && (
                          <div className="flex flex-wrap gap-1.5">
                            {isUsed && (
                              <span className="rounded-full bg-warning-muted px-2 py-0.5 text-[10px] font-medium text-warning">
                                כבר בזוג אחר בטווח הזה
                              </span>
                            )}
                            {isCoachMatch && (
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                מהקבוצה של המאמן/ת
                              </span>
                            )}
                            {isScheduledEarlier && (
                              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
                                שובץ בטווח קודם
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      <div className="flex shrink-0 justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="button" disabled={selectedIds.length === 0} onClick={handleConfirm}>
          אישור
        </Button>
      </div>
    </div>
  );
}

// One pair row - stacks vertically on narrow screens (no wide table), large
// tap targets. The trainee selectors here remain fully editable after
// creation (via the picker or directly loaded from the server) - only the
// picker itself is reserved for creating a brand-new pair.
// Quick-choice horse buttons for a pair row, derived from the two selected
// trainees' currently assigned horses (candidate.horseName - same raw,
// original-capitalization field computePrefillHorse already uses for the
// one-time pair-creation prefill). Suggestions only: clicking never disables
// further manual edits, and nothing here re-runs automatically when the
// trainee selection changes later (that would silently overwrite a horse the
// user already chose) - see PairRowEditor's own render for the trigger.
function quickHorseChoices(
  trainee1: RidingSlotComplexTraineeCandidate | null,
  trainee2: RidingSlotComplexTraineeCandidate | null
): string[] {
  const h1 = trainee1?.horseName?.trim() || null;
  const h2 = trainee2?.horseName?.trim() || null;
  const choices: string[] = [];
  if (h1) choices.push(h1);
  if (h2 && (!h1 || h2.toLowerCase() !== h1.toLowerCase())) choices.push(h2);
  return choices;
}

function PairRowEditor({
  pair,
  candidates,
  knownHorseNames,
  onChange,
  onRemove,
}: {
  pair: PairDraft;
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  onChange: (next: PairDraft) => void;
  onRemove: () => void;
}) {
  const [showNote, setShowNote] = useState(Boolean(pair.note));
  const horseInputRef = useRef<{ focus: () => void } | null>(null);

  const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id) ?? null;
  const trainee2 = pair.trainee2Id ? (candidates.find((c) => c.studentId === pair.trainee2Id) ?? null) : null;
  const horseChoices = quickHorseChoices(trainee1, trainee2);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TraineePicker
          candidates={candidates}
          value={pair.trainee1Id}
          onChange={(id) => onChange({ ...pair, trainee1Id: id })}
          placeholder="חניכ/ה 1"
        />
        <span className="hidden shrink-0 text-muted-foreground sm:inline">+</span>
        <TraineePicker
          candidates={candidates}
          value={pair.trainee2Id}
          onChange={(id) => onChange({ ...pair, trainee2Id: id })}
          placeholder="חניכ/ה 2 (אופציונלי)"
        />
      </div>
      <PairContextInfo pair={pair} candidates={candidates} />
      {(horseChoices.length > 0 || pair.trainee1Id) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {horseChoices.map((h) => (
            <Button
              key={h}
              type="button"
              variant="secondary"
              className="!px-2 !py-1 !text-xs"
              onClick={() => onChange({ ...pair, horseName: h })}
            >
              {h}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="!px-2 !py-1 !text-xs"
            onClick={() => horseInputRef.current?.focus()}
          >
            סוס אחר
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SuggestInput
            ref={horseInputRef}
            value={pair.horseName}
            onChange={(v) => onChange({ ...pair, horseName: v })}
            suggestions={knownHorseNames}
            placeholder="סוס"
          />
        </div>
        <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs" onClick={() => setShowNote((v) => !v)}>
          {showNote ? "הסתרת הערה" : "הוספת הערה"}
        </Button>
        <Button type="button" variant="ghost" className="!px-2 !py-1 !text-xs text-danger" onClick={onRemove}>
          הסרת זוג
        </Button>
      </div>
      {showNote && (
        <input
          type="text"
          value={pair.note}
          onChange={(e) => onChange({ ...pair, note: e.target.value })}
          placeholder="הערה קצרה"
          className="w-full rounded-lg border border-border px-3 py-2 text-sm"
        />
      )}
    </div>
  );
}

// Level 1.5: time-only block editor, shared for both a brand-new block and
// an existing one - keyed by the parent on view.blockId, so switching
// targets always remounts fresh rather than reusing stale draft state.
function BlockTimeEditorForm({
  actor,
  ridingSlotId,
  block,
  onSaved,
  onCancel,
}: {
  actor: RidingComplexPlanEditorActor;
  ridingSlotId: string;
  block: RidingSlotComplexBlockRow | null;
  onSaved: (
    plan: RidingSlotComplexPlanRow,
    overlapWarning: string | undefined,
    savedBlockId: string | null,
    missingNewBlockId: boolean
  ) => void;
  onCancel: () => void;
}) {
  const [startTime, setStartTime] = useState(block?.startTime ?? "");
  const [endTime, setEndTime] = useState(block?.endTime ?? "");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const isSavingRef = useRef(false);

  const canSave = Boolean(startTime) && Boolean(endTime) && timeToMinutes(endTime) > timeToMinutes(startTime);

  function handleSave() {
    if (!canSave || isSavingRef.current) return;
    isSavingRef.current = true;
    setSaveError(null);
    startSaveTransition(async () => {
      const result = await saveComplexBlock(actor, {
        ridingSlotId,
        blockId: block ? block.id : undefined,
        startTime,
        endTime,
      });
      isSavingRef.current = false;
      if (!result.success || !result.plan) {
        setSaveError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      // Editing an existing block: its id is already known, never inferred.
      // Creating a new block: only the server-returned newBlockId identifies
      // it - never the last array element, max sortOrder, createdAt, or an
      // id diff, none of which are a stable identity guarantee under
      // concurrent creation or equal/changed sort ordering.
      if (block) {
        onSaved(result.plan, result.overlapWarning, block.id, false);
      } else {
        onSaved(result.plan, result.overlapWarning, result.newBlockId ?? null, !result.newBlockId);
      }
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            שעת התחלה
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            שעת סיום
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-sm"
            />
          </label>
        </div>
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="button" disabled={!canSave || isSaving} onClick={handleSave}>
          {isSaving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}

// Level 3: single coach station editor - coach, arena, and this station's
// own pairs only. Keyed by the parent on view.stationId, so switching
// targets always remounts fresh.
function StationEditorForm({
  actor,
  ridingSlotId,
  blockId,
  block,
  earlierBlocks,
  station,
  canEdit,
  instructors,
  candidates,
  knownHorseNames,
  onSaved,
  onCancel,
}: {
  actor: RidingComplexPlanEditorActor;
  ridingSlotId: string;
  blockId: string;
  block: RidingSlotComplexBlockRow;
  // Every block in the same plan that sorts before this one (by
  // block.sortOrder) - used only for the non-blocking "assigned in an
  // earlier block" indicator in ContextualPairPicker.
  earlierBlocks: RidingSlotComplexBlockRow[];
  station: RidingSlotComplexStationRow | null;
  // When false, this renders a read-only detail view instead (below) - a
  // read-only viewer only ever reaches this via "צפייה" on an EXISTING
  // station (StationCard hides "+ הוספת תחנת מאמן" entirely for canEdit
  // false), so `station` is always non-null in that branch.
  canEdit: boolean;
  instructors: InstructorOption[];
  candidates: RidingSlotComplexTraineeCandidate[];
  knownHorseNames: string[];
  onSaved: (plan: RidingSlotComplexPlanRow, warnings: RidingSlotComplexSaveWarnings) => void;
  onCancel: () => void;
}) {
  const [instructorId, setInstructorId] = useState(station?.instructorId ?? "");
  const [arena, setArena] = useState(station?.arena ?? "");
  const [pairs, setPairs] = useState<PairDraft[]>(station ? station.pairs.map(pairDraftFromRow) : []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();
  const isSavingRef = useRef(false);

  function updatePair(key: number, next: PairDraft) {
    setPairs((current) => current.map((p) => (p.key === key ? next : p)));
  }
  function removePair(key: number) {
    setPairs((current) => current.filter((p) => p.key !== key));
  }

  const otherStations = summarizeOtherStations(block, station?.id ?? null);
  const clientIssues = computeStationClientIssues(pairs, instructorId || null, otherStations);
  const canSave = clientIssues.length === 0;

  const usedTraineeIds = computeUsedTraineeIds(block, station?.id ?? null, pairs);
  const stationInstructorName = instructors.find((i) => i.id === instructorId)?.fullName ?? null;
  const earlierAssignedTraineeIds = {
    ids: computeEarlierAssignedTraineeIds(earlierBlocks),
    hasEarlierBlocks: earlierBlocks.length > 0,
  };

  function handleSave() {
    if (!canSave || isSavingRef.current) return;
    isSavingRef.current = true;
    setSaveError(null);
    startSaveTransition(async () => {
      const result = await saveComplexStation(actor, {
        ridingSlotId,
        blockId,
        stationId: station ? station.id : undefined,
        instructorId: instructorId || null,
        arena: arena || null,
        pairs: pairs.map((p) => ({
          trainee1Id: p.trainee1Id,
          trainee2Id: p.trainee2Id || null,
          horseName: p.horseName || null,
          note: p.note || null,
        })),
      });
      isSavingRef.current = false;
      if (!result.success || !result.plan) {
        setSaveError(result.error ?? "אירעה שגיאה בשמירה");
        return;
      }
      onSaved(
        result.plan,
        result.warnings ?? {
          noInstructor: !instructorId,
          noArena: !arena,
          zeroPairs: pairs.filter((p) => p.trainee1Id).length === 0,
          pairsMissingTrainee2: 0,
          pairsMissingHorse: 0,
        }
      );
    });
  }

  function handlePickerConfirm(trainee1Id: string, trainee2Id: string | null, prefillHorse: string) {
    setPairs((current) => [...current, newPairDraftFrom(trainee1Id, trainee2Id ?? "", prefillHorse)]);
    setPickerOpen(false);
  }

  // Read-only detail view - static text only, no inputs, no picker, no
  // Save - just a Back button. `station` is always non-null here (see the
  // canEdit prop's own comment above).
  if (!canEdit) {
    const coachName = instructors.find((i) => i.id === instructorId)?.fullName ?? null;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1 text-sm">
          <p>
            <span className="text-muted-foreground">מאמן/ת: </span>
            {coachName ?? "לא הוגדר מאמן"}
          </p>
          <p>
            <span className="text-muted-foreground">מגרש: </span>
            {arena || "לא הוגדר מגרש"}
          </p>
          <div className="flex flex-col gap-2">
            <p className="font-semibold text-card-foreground">זוגות</p>
            {pairs.length === 0 ? (
              <p className="text-muted-foreground">אין זוגות בתחנה זו</p>
            ) : (
              pairs.map((pair) => {
                const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id);
                const trainee2 = candidates.find((c) => c.studentId === pair.trainee2Id);
                return (
                  <div key={pair.key} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2.5">
                    <p className="font-medium text-card-foreground">
                      {trainee1?.studentName ?? "לא נבחר/ה"}
                      {trainee2 ? ` + ${trainee2.studentName}` : ""}
                    </p>
                    <p className="text-muted-foreground">סוס: {pair.horseName || "לא הוגדר"}</p>
                    {pair.note && <p className="text-muted-foreground">הערה: {pair.note}</p>}
                    <PairContextInfo pair={pair} candidates={candidates} />
                  </div>
                );
              })
            )}
          </div>
        </div>
        <div className="flex shrink-0 justify-end">
          <Button type="button" variant="secondary" onClick={onCancel}>
            חזרה
          </Button>
        </div>
      </div>
    );
  }

  if (pickerOpen) {
    return (
      <ContextualPairPicker
        candidates={candidates}
        usedTraineeIds={usedTraineeIds}
        earlierAssignedTraineeIds={earlierAssignedTraineeIds}
        stationInstructorName={stationInstructorName}
        onConfirm={handlePickerConfirm}
        onCancel={() => setPickerOpen(false)}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto ps-1">
        <label className="flex flex-col gap-1 text-sm">
          מאמן/ת
          <StationCoachPicker instructors={instructors} value={instructorId} onChange={setInstructorId} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          מגרש
          <input
            type="text"
            value={arena}
            onChange={(e) => setArena(e.target.value)}
            placeholder="למשל: מגרש 1"
            className="rounded-lg border border-border px-3 py-2 text-sm"
          />
        </label>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-card-foreground">זוגות</p>
            <Button
              type="button"
              variant="secondary"
              className="!px-2 !py-1 !text-xs"
              onClick={() => setPickerOpen(true)}
            >
              + הוספת זוג
            </Button>
          </div>
          {pairs.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין עדיין זוגות בתחנה זו</p>
          ) : (
            <div className="flex flex-col gap-2">
              {pairs.map((pair) => (
                <PairRowEditor
                  key={pair.key}
                  pair={pair}
                  candidates={candidates}
                  knownHorseNames={knownHorseNames}
                  onChange={(next) => updatePair(pair.key, next)}
                  onRemove={() => removePair(pair.key)}
                />
              ))}
            </div>
          )}
        </div>

        {clientIssues.length > 0 && (
          <div className="rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
            {clientIssues.map((issue) => (
              <p key={issue}>{issue}</p>
            ))}
          </div>
        )}
        {saveError && <p className="text-sm text-danger">{saveError}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="button" disabled={!canSave || isSaving} onClick={handleSave}>
          {isSaving ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}

// Level 1 list card - one time block, summarized by station/pair counts and
// live incompleteness/overlap badges.
function BlockCard({
  block,
  index,
  total,
  canEdit,
  hasOverlap,
  onOpenStations,
  onEditTimes,
  onDuplicate,
  onDelete,
  onMoveUp,
  onMoveDown,
  pendingDisabled,
}: {
  block: RidingSlotComplexBlockRow;
  index: number;
  total: number;
  canEdit: boolean;
  hasOverlap: boolean;
  onOpenStations: () => void;
  onEditTimes: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pendingDisabled: boolean;
}) {
  const totalPairs = block.stations.reduce((sum, s) => sum + s.pairs.length, 0);
  const warningBadges = blockStationWarningBadges(block);

  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-bold text-card-foreground">
          {block.startTime}–{block.endTime}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {block.stations.length} תחנות
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{totalPairs} זוגות</span>
          {hasOverlap && (
            <span className="rounded-full bg-warning-muted px-2 py-0.5 text-xs font-medium text-warning">
              חופף לטווח אחר
            </span>
          )}
        </div>
      </div>
      {warningBadges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {warningBadges.map((b) => (
            <span key={b} className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onOpenStations} disabled={pendingDisabled}>
          {canEdit ? "פתיחה / ניהול תחנות" : "צפייה בתחנות"}
        </Button>
        {canEdit && (
          <>
            <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onEditTimes} disabled={pendingDisabled}>
              עריכת שעות
            </Button>
            <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onDuplicate} disabled={pendingDisabled}>
              שכפול
            </Button>
            <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={onDelete} disabled={pendingDisabled}>
              מחיקה
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveUp}
              disabled={pendingDisabled || index === 0}
              aria-label="הזזה למעלה"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveDown}
              disabled={pendingDisabled || index === total - 1}
              aria-label="הזזה למטה"
            >
              ↓
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Level 2 list card - one coach station within a block. Deliberately no
// duplicate action (stations are not duplicable, only blocks are).
function StationCard({
  station,
  index,
  total,
  canEdit,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  pendingDisabled,
}: {
  station: RidingSlotComplexStationRow;
  index: number;
  total: number;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  pendingDisabled: boolean;
}) {
  const badges = stationWarningBadges(station);

  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-bold text-card-foreground">
          {station.instructor?.fullName ?? "לא הוגדר מאמן"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {station.pairs.length} זוגות
        </span>
      </div>
      <p className="truncate text-sm text-card-foreground">מגרש: {station.arena ?? "לא הוגדר מגרש"}</p>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span key={b} className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
              {b}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" className="!px-2 !py-1 !text-xs" onClick={onEdit} disabled={pendingDisabled}>
          {canEdit ? "עריכה" : "צפייה"}
        </Button>
        {canEdit && (
          <>
            <Button variant="danger" className="!px-2 !py-1 !text-xs" onClick={onDelete} disabled={pendingDisabled}>
              מחיקה
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveUp}
              disabled={pendingDisabled || index === 0}
              aria-label="הזזה למעלה"
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              className="!px-2 !py-1 !text-xs"
              onClick={onMoveDown}
              disabled={pendingDisabled || index === total - 1}
              aria-label="הזזה למטה"
            >
              ↓
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// Read-only "show all" overview of one station - same fields as StationCard
// plus each pair's trainees/horse/note inline, so a read-only instructor can
// read the whole block without opening every station's own detail view (that
// detail view, StationEditorForm's canEdit===false branch, stays reachable
// via "פתיחת תחנה" for anyone who still wants it focused on one station).
// Never rendered for an editable actor - no mutation controls exist here at
// all, matching StationEditorForm's own read-only branch.
function StationOverviewCard({
  station,
  candidates,
  onOpenDetail,
}: {
  station: RidingSlotComplexStationRow;
  candidates: RidingSlotComplexTraineeCandidate[];
  onOpenDetail: () => void;
}) {
  const badges = stationWarningBadges(station);

  return (
    <div className="flex flex-col gap-2 rounded-xl border-2 border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="text-base font-bold text-card-foreground">
          {station.instructor?.fullName ?? "לא הוגדר מאמן"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {station.pairs.length} זוגות
        </span>
      </div>
      <p className="truncate text-sm text-card-foreground">מגרש: {station.arena ?? "לא הוגדר מגרש"}</p>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b) => (
            <span key={b} className="rounded-full bg-warning-muted px-2 py-0.5 text-[11px] font-medium text-warning">
              {b}
            </span>
          ))}
        </div>
      )}
      {station.pairs.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין זוגות בתחנה זו</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {station.pairs.map((pair) => {
            const trainee1 = candidates.find((c) => c.studentId === pair.trainee1Id);
            const trainee2 = candidates.find((c) => c.studentId === pair.trainee2Id);
            return (
              <div key={pair.id} className="rounded-lg bg-muted/50 p-2 text-xs">
                <p className="font-medium text-card-foreground">
                  {trainee1?.studentName ?? pair.trainee1Name ?? "לא נבחר/ה"}
                  {trainee2 || pair.trainee2Name ? ` + ${trainee2?.studentName ?? pair.trainee2Name}` : ""}
                </p>
                <p className="text-muted-foreground">
                  סוס: {pair.horseName || "לא הוגדר"}
                  {pair.note ? ` · הערה: ${pair.note}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={onOpenDetail}>
          פתיחת תחנה
        </Button>
      </div>
    </div>
  );
}

// Shared complex-session editor, opened as its own Modal exactly like
// RidingHorseListEditor - entirely self-contained (fetches on open, saves
// via the P5b actions routed through the actor prop) so the caller only
// needs to own the open/close boolean and pass ridingSlotId/instructors/actor.
// Reused unchanged by both the admin RidingSlotModal and the instructor
// screen - every operation routes through the eight small private helpers
// above; canEdit (server-returned) gates every mutating control, and
// whole-plan deletion stays admin-only regardless of canEdit.
export function RidingComplexPlanEditor({
  open,
  onClose,
  ridingSlotId,
  contextLabel,
  instructors,
  actor,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  ridingSlotId: string;
  contextLabel?: string;
  instructors: InstructorOption[];
  actor: RidingComplexPlanEditorActor;
  onDeleted: () => void;
}) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [editing, setEditing] = useState<RidingSlotComplexPlanForEditing | null>(null);
  const [view, setView] = useState<EditorView>({ type: "blockList" });
  const [lastOverlapWarning, setLastOverlapWarning] = useState<string | null>(null);
  const [lastStationWarnings, setLastStationWarnings] = useState<RidingSlotComplexSaveWarnings | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [stationListError, setStationListError] = useState<string | null>(null);
  const [busyBlockId, setBusyBlockId] = useState<string | null>(null);
  const [busyStationId, setBusyStationId] = useState<string | null>(null);
  // Read-only-instructor-only compact overview toggle for the station list
  // (see StationOverviewCard) - never affects an editable actor's station
  // list, which always renders the original StationCard-per-station view.
  const [showAllStations, setShowAllStations] = useState(false);
  const [isReorderingBlocks, startReorderBlocksTransition] = useTransition();
  const [isDuplicatingBlock, startDuplicateBlockTransition] = useTransition();
  const [isDeletingBlock, startDeleteBlockTransition] = useTransition();
  const [isReorderingStations, startReorderStationsTransition] = useTransition();
  const [isDeletingStation, startDeleteStationTransition] = useTransition();
  const [isDeletingPlan, startDeletePlanTransition] = useTransition();
  const [deletePlanError, setDeletePlanError] = useState<string | null>(null);

  const anyBlockActionPending = isReorderingBlocks || isDuplicatingBlock || isDeletingBlock;
  const anyStationActionPending = isReorderingStations || isDeletingStation;

  // Resets ALL local state every time the modal opens (or targets a
  // different RidingSlot) - same convention as RidingHorseListEditor's own
  // load effect. `cancelled` guards against a stale response landing after
  // the target changed or the modal closed/unmounted.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("loading");
    setEditing(null);
    setView({ type: "blockList" });
    setLastOverlapWarning(null);
    setLastStationWarnings(null);
    setListError(null);
    setStationListError(null);
    setDeletePlanError(null);
    setShowAllStations(false);

    readComplexPlan(actor, ridingSlotId)
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setStatus("not-found");
          return;
        }
        setEditing(result);
        setStatus("loaded");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
    // actor is not included: it identifies WHO is looking, not WHAT is being
    // looked at - re-fetching only needs to react to open/ridingSlotId, same
    // as every other editor in this app keys its load effect on the target,
    // not the caller's own identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ridingSlotId]);

  function refreshPlan(plan: RidingSlotComplexPlanRow) {
    setEditing((prev) => (prev ? { ...prev, plan } : prev));
  }

  function handleBlockTimeSaved(
    plan: RidingSlotComplexPlanRow,
    overlapWarning: string | undefined,
    savedBlockId: string | null,
    missingNewBlockId: boolean
  ) {
    refreshPlan(plan);
    setLastOverlapWarning(overlapWarning ?? null);
    setStationListError(null);
    setLastStationWarnings(null);
    if (savedBlockId) {
      setView({ type: "stationList", blockId: savedBlockId });
      return;
    }
    // A successful create that unexpectedly came back without newBlockId -
    // never guess which block was just created; fall back to the block list
    // (the refreshed plan already includes it) and surface a small notice.
    setListError(missingNewBlockId ? "טווח השעות נוצר, אך לא ניתן היה לפתוח את תחנות המאמן שלו אוטומטית" : null);
    setView({ type: "blockList" });
  }

  function handleCancelBlockEdit() {
    setView({ type: "blockList" });
  }

  function handleOpenStations(blockId: string) {
    setStationListError(null);
    setLastStationWarnings(null);
    setShowAllStations(false);
    setView({ type: "stationList", blockId });
  }

  function handleBackToBlockList() {
    setView({ type: "blockList" });
  }

  function handleDuplicateBlock(blockId: string) {
    if (anyBlockActionPending) return;
    setListError(null);
    setBusyBlockId(blockId);
    startDuplicateBlockTransition(async () => {
      const result = await duplicateComplexBlock(actor, ridingSlotId, blockId);
      setBusyBlockId(null);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה בשכפול הבלוק");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleDeleteBlock(blockId: string) {
    if (anyBlockActionPending) return;
    if (!window.confirm("למחוק את טווח השעות הזה? כל התחנות והזוגות בו יימחקו. לא ניתן לשחזר את הפעולה.")) return;
    setListError(null);
    setBusyBlockId(blockId);
    startDeleteBlockTransition(async () => {
      const result = await deleteComplexBlock(actor, ridingSlotId, blockId);
      setBusyBlockId(null);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה במחיקת טווח השעות");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleMoveBlock(blockId: string, direction: "up" | "down") {
    if (anyBlockActionPending || !editing) return;
    const ids = editing.plan.blocks.map((b) => b.id);
    const index = ids.indexOf(blockId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= ids.length) return;
    const reordered = [...ids];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

    setListError(null);
    startReorderBlocksTransition(async () => {
      const result = await reorderComplexBlocks(actor, ridingSlotId, reordered);
      if (!result.success || !result.plan) {
        setListError(result.error ?? "אירעה שגיאה בסידור טווחי השעות");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleStationSaved(plan: RidingSlotComplexPlanRow, warnings: RidingSlotComplexSaveWarnings) {
    refreshPlan(plan);
    setLastStationWarnings(warnings);
    if (view.type === "editStation") {
      setView({ type: "stationList", blockId: view.blockId });
    }
  }

  function handleCancelStationEdit() {
    if (view.type === "editStation") {
      setView({ type: "stationList", blockId: view.blockId });
    } else {
      setView({ type: "blockList" });
    }
  }

  function handleDeleteStation(blockId: string, stationId: string) {
    if (anyStationActionPending) return;
    if (!window.confirm("למחוק את תחנת המאמן הזו? כל הזוגות בה יימחקו. לא ניתן לשחזר את הפעולה.")) return;
    setStationListError(null);
    setBusyStationId(stationId);
    startDeleteStationTransition(async () => {
      const result = await deleteComplexStation(actor, ridingSlotId, blockId, stationId);
      setBusyStationId(null);
      if (!result.success || !result.plan) {
        setStationListError(result.error ?? "אירעה שגיאה במחיקת התחנה");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  function handleMoveStation(blockId: string, stationId: string, direction: "up" | "down") {
    if (anyStationActionPending || !editing) return;
    const block = editing.plan.blocks.find((b) => b.id === blockId);
    if (!block) return;
    const ids = block.stations.map((s) => s.id);
    const index = ids.indexOf(stationId);
    const swapWith = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || swapWith < 0 || swapWith >= ids.length) return;
    const reordered = [...ids];
    [reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]];

    setStationListError(null);
    startReorderStationsTransition(async () => {
      const result = await reorderComplexStations(actor, ridingSlotId, blockId, reordered);
      if (!result.success || !result.plan) {
        setStationListError(result.error ?? "אירעה שגיאה בסידור התחנות");
        return;
      }
      refreshPlan(result.plan);
    });
  }

  // Admin-only regardless of canEdit - an instructor actor never reaches
  // this (the button itself is never rendered for actor.type === "instructor",
  // see the render below), but the guard is kept here too since the server
  // action itself has no instructor variant to call by mistake.
  function handleDeletePlan() {
    if (actor.type !== "admin" || isDeletingPlan) return;
    if (
      !window.confirm(
        "למחוק את כל תכנון הרכיבה המורכב? כל טווחי השעות, התחנות והזוגות בתכנון זה יימחקו לצמיתות. לא ניתן לשחזר את הפעולה."
      )
    ) {
      return;
    }
    setDeletePlanError(null);
    startDeletePlanTransition(async () => {
      const result = await deleteRidingSlotComplexPlanAsAdmin(ridingSlotId);
      if (!result.success) {
        setDeletePlanError(result.error ?? "אירעה שגיאה במחיקת התכנון");
        return;
      }
      onDeleted();
    });
  }

  const plan = editing?.plan ?? null;
  const scheduleMeta = editing?.scheduleMeta ?? null;
  // Server-returned, never a client-side assumption - always true for admin
  // (see getRidingSlotComplexPlanForAdmin), reflects canEditRidingNotes for
  // an instructor actor. Gates every mutating control below; the P5b actions
  // themselves remain the actual authority regardless of what this hides.
  const canEdit = editing?.canEdit ?? false;

  const overlappingBlockIds = plan ? computeOverlappingBlockIds(plan.blocks) : new Set<string>();

  // Defensive fallback if the block/station targeted by `view` no longer
  // exists in the refreshed plan (e.g. deleted from another tab) - avoids a
  // crash, simply drops back to the block list.
  const activeBlock =
    plan && (view.type === "stationList" || view.type === "editStation")
      ? (plan.blocks.find((b) => b.id === view.blockId) ?? null)
      : null;
  if (plan && (view.type === "stationList" || view.type === "editStation") && !activeBlock) {
    setView({ type: "blockList" });
  }
  const activeStation =
    activeBlock && view.type === "editStation" && view.stationId
      ? (activeBlock.stations.find((s) => s.id === view.stationId) ?? null)
      : null;

  return (
    <Modal
      open={open}
      title={contextLabel ? `תכנון רכיבה מורכבת - ${contextLabel}` : "תכנון רכיבה מורכבת"}
      size="large"
      onClose={onClose}
    >
      <div className="flex h-full flex-col gap-3">
        {status === "loading" && <p className="text-sm text-muted-foreground">טוען...</p>}
        {status === "not-found" && (
          <p className="text-sm text-danger">רכיבה זו לא נמצאה. ייתכן שנמחקה - סגרו ורעננו את העמוד.</p>
        )}
        {status === "error" && <p className="text-sm text-danger">שגיאה בטעינת התכנון. נסו לרענן.</p>}

        {status === "loaded" && editing && plan && (
          <>
            <div className="shrink-0 rounded-lg bg-secondary p-2.5 text-xs text-secondary-foreground">
              {scheduleMeta && (
                <p className="font-semibold">
                  {cleanScheduleTitle(scheduleMeta.activityTitle)} ·{" "}
                  {formatHebrewDate(parseDateKey(scheduleMeta.dateKey))} · {scheduleMeta.startTime}-
                  {scheduleMeta.endTime}
                </p>
              )}
              <p className="mt-0.5">
                עודכן ע&quot;י {plan.updatedByName} · {formatHebrewDateTime(new Date(plan.updatedAt))}
              </p>
            </div>

            {view.type === "blockList" && (
              <>
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-card-foreground">טווחי שעות</p>
                  {canEdit && (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => setView({ type: "editBlock", blockId: null })}
                      disabled={anyBlockActionPending}
                    >
                      + הוספת טווח שעות
                    </Button>
                  )}
                </div>

                {lastOverlapWarning && (
                  <p className="shrink-0 rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
                    {lastOverlapWarning}
                  </p>
                )}
                {listError && <p className="shrink-0 text-sm text-danger">{listError}</p>}

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto ps-1">
                  {plan.blocks.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-6 text-center">
                      <p className="text-sm text-muted-foreground">עדיין לא הוגדרו טווחי שעות לתכנון זה</p>
                      {canEdit && (
                        <Button onClick={() => setView({ type: "editBlock", blockId: null })}>
                          הוספת טווח שעות ראשון
                        </Button>
                      )}
                    </div>
                  ) : (
                    plan.blocks.map((block, index) => (
                      <BlockCard
                        key={block.id}
                        block={block}
                        index={index}
                        total={plan.blocks.length}
                        canEdit={canEdit}
                        hasOverlap={overlappingBlockIds.has(block.id)}
                        pendingDisabled={anyBlockActionPending || busyBlockId === block.id}
                        onOpenStations={() => handleOpenStations(block.id)}
                        onEditTimes={() => setView({ type: "editBlock", blockId: block.id })}
                        onDuplicate={() => handleDuplicateBlock(block.id)}
                        onDelete={() => handleDeleteBlock(block.id)}
                        onMoveUp={() => handleMoveBlock(block.id, "up")}
                        onMoveDown={() => handleMoveBlock(block.id, "down")}
                      />
                    ))
                  )}
                </div>

                {actor.type === "admin" && (
                  <div className="shrink-0 border-t border-border pt-3">
                    {deletePlanError && <p className="mb-2 text-sm text-danger">{deletePlanError}</p>}
                    <Button variant="danger" className="!text-xs" onClick={handleDeletePlan} disabled={isDeletingPlan}>
                      {isDeletingPlan ? "מוחק..." : "מחיקת התכנון המורכב"}
                    </Button>
                  </div>
                )}
              </>
            )}

            {view.type === "editBlock" && (
              <BlockTimeEditorForm
                key={view.blockId ?? "new"}
                actor={actor}
                ridingSlotId={ridingSlotId}
                block={view.blockId ? (plan.blocks.find((b) => b.id === view.blockId) ?? null) : null}
                onSaved={handleBlockTimeSaved}
                onCancel={handleCancelBlockEdit}
              />
            )}

            {view.type === "stationList" && activeBlock && (
              <>
                <p className="shrink-0 truncate text-xs text-muted-foreground">
                  תכנון רכיבה מורכבת › {activeBlock.startTime}–{activeBlock.endTime} › תחנות מאמן
                </p>
                <div className="flex shrink-0 items-center justify-between gap-2">
                  <Button variant="ghost" className="!px-2 !py-1 !text-xs" onClick={handleBackToBlockList}>
                    ← חזרה לטווחי השעות
                  </Button>
                  {canEdit ? (
                    <Button
                      variant="secondary"
                      className="!px-2 !py-1 !text-xs"
                      onClick={() => setView({ type: "editStation", blockId: activeBlock.id, stationId: null })}
                      disabled={anyStationActionPending}
                    >
                      + הוספת תחנת מאמן
                    </Button>
                  ) : (
                    activeBlock.stations.length > 0 && (
                      <Button
                        variant="secondary"
                        className="!px-2 !py-1 !text-xs"
                        onClick={() => setShowAllStations((v) => !v)}
                      >
                        {showAllStations ? "הצגת רשימה מקוצרת" : "הצגת כל השיבוץ"}
                      </Button>
                    )
                  )}
                </div>

                {lastStationWarnings && buildStationWarningMessages(lastStationWarnings).length > 0 && (
                  <div className="shrink-0 rounded-lg border border-warning/40 bg-warning-muted/30 p-2.5 text-sm text-warning">
                    {buildStationWarningMessages(lastStationWarnings).map((m) => (
                      <p key={m}>{m}</p>
                    ))}
                  </div>
                )}
                {stationListError && <p className="shrink-0 text-sm text-danger">{stationListError}</p>}

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto ps-1">
                  {activeBlock.stations.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border p-6 text-center">
                      <p className="text-sm text-muted-foreground">עדיין לא הוגדרו תחנות מאמן בטווח זה</p>
                      {canEdit && (
                        <Button
                          onClick={() => setView({ type: "editStation", blockId: activeBlock.id, stationId: null })}
                        >
                          הוספת תחנת מאמן ראשונה
                        </Button>
                      )}
                    </div>
                  ) : !canEdit && showAllStations ? (
                    activeBlock.stations.map((station) => (
                      <StationOverviewCard
                        key={station.id}
                        station={station}
                        candidates={editing.candidates}
                        onOpenDetail={() =>
                          setView({ type: "editStation", blockId: activeBlock.id, stationId: station.id })
                        }
                      />
                    ))
                  ) : (
                    activeBlock.stations.map((station, index) => (
                      <StationCard
                        key={station.id}
                        station={station}
                        index={index}
                        total={activeBlock.stations.length}
                        canEdit={canEdit}
                        pendingDisabled={anyStationActionPending || busyStationId === station.id}
                        onEdit={() => setView({ type: "editStation", blockId: activeBlock.id, stationId: station.id })}
                        onDelete={() => handleDeleteStation(activeBlock.id, station.id)}
                        onMoveUp={() => handleMoveStation(activeBlock.id, station.id, "up")}
                        onMoveDown={() => handleMoveStation(activeBlock.id, station.id, "down")}
                      />
                    ))
                  )}
                </div>
              </>
            )}

            {view.type === "editStation" && activeBlock && (
              <StationEditorForm
                key={view.stationId ?? "new"}
                actor={actor}
                ridingSlotId={ridingSlotId}
                blockId={activeBlock.id}
                block={activeBlock}
                earlierBlocks={plan.blocks.filter((b) => b.sortOrder < activeBlock.sortOrder)}
                station={activeStation}
                canEdit={canEdit}
                instructors={instructors}
                candidates={editing.candidates}
                knownHorseNames={editing.knownHorseNames}
                onSaved={handleStationSaved}
                onCancel={handleCancelStationEdit}
              />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
