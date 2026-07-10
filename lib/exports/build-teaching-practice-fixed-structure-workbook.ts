import { Workbook, type Worksheet } from "exceljs";
import type { TeachingPracticeTrackSummary } from "@/lib/actions/teaching-practice";

// Fixed-structure export - NOT generated dated lessons. Two sections per
// sheet:
//  - LUNGE: one row per LUNGE track.
//  - Beginner private/group: one row per BEGINNER_PRIVATE track, whether or
//    not it's linked to a BEGINNER_GROUP block. A linked group block is
//    represented by exactly its 3 linked private rows (normally) - no
//    separate BEGINNER_GROUP summary row is ever exported, matching the
//    actual on-screen/product model: the group lesson is conceptually built
//    FROM those 3 private rows, not a distinct thing alongside them. Each
//    linked row carries both its own (private) time and the group's time in
//    two separate columns.
//
// Never reads TeachingPracticeLesson/Participant/ChildAssignment/Feedback -
// only the already-loaded TeachingPracticeTrackSummary shape (same one
// listTeachingPracticeTracksForAdmin already returns for the UI).

const HEADER_FILL = {
  type: "pattern" as const,
  pattern: "solid" as const,
  fgColor: { argb: "FFDCEEF7" },
};

// Mirrors PRACTICE_TYPE_LABELS in TeachingPracticeManager.tsx - duplicated
// (not imported) since that's a client component this server module can't
// import from, same small deliberate duplication already used for
// compareLinkedPrivateTracks in lib/actions/teaching-practice-full-sync.ts,
// -preview.ts, and lib/teaching-practice-fixed-structure-check.ts.
const LUNGE_LABEL = "לונג׳";
const BEGINNER_COMBINED_LABEL = "שיעור פרטי + קבוצתי מתחילים";
const BEGINNER_PRIVATE_ONLY_LABEL = "שיעור פרטי מתחילים";

// Both sections use 10 columns, in the same physical positions, so one
// shared column-width/wrap-column setup works for both without a mismatch -
// only the header labels and the semantic content of columns 2-6 differ
// between sections (see LUNGE_HEADERS / BEGINNER_HEADERS below).
const COLUMN_WIDTHS = [20, 13, 13, 16, 16, 16, 16, 14, 20, 30];
// 1-based column indices (ציוד/הערות) - the only free-text fields long
// enough to need wrapping rather than truncation/overflow, in both sections.
const WRAP_COLUMNS = new Set([9, 10]);

const LUNGE_HEADERS = [
  "סוג התנסות",
  "שעה",
  "מיקום",
  "מדריך אחראי",
  "חניך 1",
  "חניך 2",
  "ילד/ה",
  "סוס",
  "ציוד / הערות ציוד",
  "הערות / מידע נוסף",
];

// No role-labeled trainee columns here (no "מדריך/מוביל", "עוזר/מעריך",
// "נוסף") - the fixed structure has no meaningful role distinction to
// export at this level, only the single business-relevant slot
// (rotationOrder 0). שעה פרטני / שעה קבוצתי are both included on the same
// row so a linked block's private time and group time are both visible
// without a separate group row.
const BEGINNER_HEADERS = [
  "סוג התנסות",
  "שעה פרטני",
  "שעה קבוצתי",
  "מיקום",
  "מדריך אחראי",
  "חניך",
  "ילד/ה",
  "סוס",
  "ציוד / הערות ציוד",
  "הערות / מידע נוסף",
];

// exceljs's bundled .d.ts declares its own local Buffer type that doesn't
// structurally match Node's real (generic) Buffer type - same workaround
// already used in lib/exports/build-teaching-practice-workbook.ts and
// lib/exports/build-schedule-workbook.ts.
async function workbookToBytes(workbook: Workbook): Promise<Uint8Array> {
  const raw = await workbook.xlsx.writeBuffer();
  return new Uint8Array(raw as unknown as ArrayBuffer);
}

function writeRow(sheet: Worksheet, rowIndex: number, values: (string | number)[]) {
  const row = sheet.getRow(rowIndex);
  values.forEach((value, i) => {
    const col = i + 1;
    const cell = row.getCell(col);
    cell.value = value;
    cell.alignment = { horizontal: "right", vertical: "top", wrapText: WRAP_COLUMNS.has(col) };
  });
}

// Rotating pastel palette for block background fills - deliberately
// distinct from HEADER_FILL's light blue so a block's own color is never
// mistaken for a header. Six colors is enough that adjacent blocks (which
// is all that matters for scanability) are never the same shade.
const BLOCK_FILL_COLORS = ["FFFCE9D9", "FFE3F1E3", "FFEAE3F1", "FFF1E3EA", "FFE3EAF1", "FFF7F1DE"];

function blockFill(colorIndex: number) {
  return {
    type: "pattern" as const,
    pattern: "solid" as const,
    fgColor: { argb: BLOCK_FILL_COLORS[colorIndex % BLOCK_FILL_COLORS.length] },
  };
}

// Colors every cell (all dataColumnCount columns) in [startRow, endRow] with
// the given block's rotating pastel fill - never touches section-title or
// header rows, since callers only ever pass already-written data-row ranges.
function applyBlockFill(sheet: Worksheet, startRow: number, endRow: number, colorIndex: number, dataColumnCount: number) {
  const fill = blockFill(colorIndex);
  for (let r = startRow; r <= endRow; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= dataColumnCount; c++) {
      row.getCell(c).fill = fill;
    }
  }
}

// Merges + centers (horizontally and vertically) consecutive rows in `col`
// that share the same value - never spans a gap or a differing value, so
// this naturally never merges across an unrelated block when called with
// just one block's own row range. A run of length 1 still gets centered
// (no merge call needed/possible for a single cell).
function mergeConsecutiveEqualCells(sheet: Worksheet, col: number, rows: { rowIndex: number; value: string }[]) {
  let i = 0;
  while (i < rows.length) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1].value === rows[i].value) j++;
    const startRow = rows[i].rowIndex;
    const endRow = rows[j].rowIndex;
    if (endRow > startRow) {
      sheet.mergeCells(startRow, col, endRow, col);
    }
    const cell = sheet.getCell(startRow, col);
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: WRAP_COLUMNS.has(col) };
    i = j + 1;
  }
}

function traineeAtRotation(
  trainees: TeachingPracticeTrackSummary["trainees"],
  rotationOrder: number
): string | null {
  return trainees.find((t) => t.rotationOrder === rotationOrder)?.fullName ?? null;
}

function childSummary(children: TeachingPracticeTrackSummary["children"]): {
  childName: string;
  horseName: string;
  equipmentNotes: string;
} {
  const real = children.filter((c) => c.childId !== null);
  return {
    childName: real.length > 0 ? real.map((c) => c.fullName ?? "—").join(" / ") : "—",
    horseName: real.length > 0 ? real.map((c) => c.horseName ?? "—").join(" / ") : "—",
    equipmentNotes: real.length > 0 ? real.map((c) => c.equipmentNotes ?? "—").join(" / ") : "—",
  };
}

// Same ordering the fixed-structure UI already uses for linked private rows
// (compareLinkedPrivateRows in TeachingPracticeManager.tsx), replicated here
// rather than imported for the same client-component reason noted above.
// createdAt here is the ISO string TeachingPracticeTrackSummary already
// carries (not a Date) - ISO 8601 strings sort chronologically under plain
// string comparison, so localeCompare works the same as the Date.getTime()
// version used in the server-action files.
function compareLinkedPrivateTracks(a: TeachingPracticeTrackSummary, b: TeachingPracticeTrackSummary): number {
  return (
    a.defaultStartTime.localeCompare(b.defaultStartTime) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

function trackNotes(track: TeachingPracticeTrackSummary): string {
  const parts: string[] = [];
  if (!track.isActive) parts.push("(לא פעיל)");
  if (track.notes?.trim()) parts.push(track.notes.trim());
  return parts.length > 0 ? parts.join(" ") : "—";
}

function buildLungeRow(track: TeachingPracticeTrackSummary): (string | number)[] {
  const { childName, horseName, equipmentNotes } = childSummary(track.children);
  return [
    LUNGE_LABEL,
    `${track.defaultStartTime}-${track.defaultEndTime}`,
    track.defaultLocation ?? "—",
    track.defaultResponsibleInstructorName ?? "—",
    traineeAtRotation(track.trainees, 0) ?? "—",
    traineeAtRotation(track.trainees, 1) ?? "—",
    childName,
    horseName,
    equipmentNotes,
    trackNotes(track),
  ];
}

// One row per BEGINNER_PRIVATE track - its own real, persisted data
// throughout (time, location, instructor, rotationOrder-0 trainee, child/
// horse/equipment). groupTrack is only ever used for the שעה קבוצתי column
// (the linked group block's own time) - null for an unlinked private row,
// which simply leaves that column "—". Never invents an assignment: every
// value here already exists on this exact private track's own rows.
function buildBeginnerPrivateRow(
  privateTrack: TeachingPracticeTrackSummary,
  groupTrack: TeachingPracticeTrackSummary | null
): (string | number)[] {
  const { childName, horseName, equipmentNotes } = childSummary(privateTrack.children);
  return [
    groupTrack ? BEGINNER_COMBINED_LABEL : BEGINNER_PRIVATE_ONLY_LABEL,
    `${privateTrack.defaultStartTime}-${privateTrack.defaultEndTime}`,
    groupTrack ? `${groupTrack.defaultStartTime}-${groupTrack.defaultEndTime}` : "—",
    privateTrack.defaultLocation ?? "—",
    privateTrack.defaultResponsibleInstructorName ?? "—",
    traineeAtRotation(privateTrack.trainees, 0) ?? "—",
    childName,
    horseName,
    equipmentNotes,
    trackNotes(privateTrack),
  ];
}

function buildSheetForGroup(sheet: Worksheet, groupName: string, tracks: TeachingPracticeTrackSummary[]) {
  COLUMN_WIDTHS.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
  });

  let rowIndex = 1;

  sheet.mergeCells(rowIndex, 1, rowIndex, LUNGE_HEADERS.length);
  const titleCell = sheet.getCell(rowIndex, 1);
  titleCell.value = `מבנה קבוע - קבוצה ${groupName}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(rowIndex).height = 26;
  rowIndex += 2;

  function writeHeader(headers: string[]) {
    const headerRow = sheet.getRow(rowIndex);
    headers.forEach((label, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = label;
      cell.font = { bold: true };
      cell.fill = HEADER_FILL;
      cell.alignment = { horizontal: "center", vertical: "middle" };
    });
    rowIndex += 1;
  }

  function writeSectionTitle(title: string) {
    const cell = sheet.getCell(rowIndex, 1);
    cell.value = title;
    cell.font = { bold: true, size: 13 };
    rowIndex += 1;
  }

  const groupTracks = tracks.filter((t) => t.groupName === groupName);
  const lungeTracks = groupTracks
    .filter((t) => t.practiceType === "LUNGE")
    .sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime));
  const beginnerGroupTracks = groupTracks.filter((t) => t.practiceType === "BEGINNER_GROUP");
  const beginnerGroupById = new Map(beginnerGroupTracks.map((g) => [g.id, g]));
  const allPrivateTracks = groupTracks
    .filter((t) => t.practiceType === "BEGINNER_PRIVATE")
    .sort((a, b) => a.defaultStartTime.localeCompare(b.defaultStartTime));

  if (lungeTracks.length > 0) {
    writeSectionTitle(LUNGE_LABEL);
    writeHeader(LUNGE_HEADERS);
    const lungeRows: { rowIndex: number; value: string }[] = [];
    for (const track of lungeTracks) {
      const timeRange = `${track.defaultStartTime}-${track.defaultEndTime}`;
      writeRow(sheet, rowIndex, buildLungeRow(track));
      lungeRows.push({ rowIndex, value: timeRange });
      rowIndex += 1;
    }
    // Block = a consecutive run of identical שעה values - same grouping
    // drives both the merge and the rotating background color, so a block
    // is visually one merged, colored unit.
    let colorIndex = 0;
    let i = 0;
    while (i < lungeRows.length) {
      let j = i;
      while (j + 1 < lungeRows.length && lungeRows[j + 1].value === lungeRows[i].value) j++;
      applyBlockFill(sheet, lungeRows[i].rowIndex, lungeRows[j].rowIndex, colorIndex, LUNGE_HEADERS.length);
      colorIndex += 1;
      i = j + 1;
    }
    mergeConsecutiveEqualCells(sheet, 2, lungeRows);
    rowIndex += 1;
  }

  if (allPrivateTracks.length > 0) {
    writeSectionTitle("שיעורים פרטניים וקבוצתיים למתחילים");
    writeHeader(BEGINNER_HEADERS);
    // Grouped by linked BEGINNER_GROUP block (compareLinkedPrivateTracks
    // order within each block, blocks themselves ordered by their earliest
    // private track's start time), then any unlinked private tracks after -
    // no separate BEGINNER_GROUP row is ever written; each linked block is
    // represented by exactly its private rows (normally 3).
    const privateByGroupId = new Map<string, TeachingPracticeTrackSummary[]>();
    const unlinked: TeachingPracticeTrackSummary[] = [];
    for (const p of allPrivateTracks) {
      if (p.groupTrackId && beginnerGroupById.has(p.groupTrackId)) {
        const list = privateByGroupId.get(p.groupTrackId) ?? [];
        list.push(p);
        privateByGroupId.set(p.groupTrackId, list);
      } else {
        unlinked.push(p);
      }
    }

    const orderedGroupIds = [...privateByGroupId.keys()].sort((idA, idB) => {
      const earliestA = [...privateByGroupId.get(idA)!].sort(compareLinkedPrivateTracks)[0];
      const earliestB = [...privateByGroupId.get(idB)!].sort(compareLinkedPrivateTracks)[0];
      return compareLinkedPrivateTracks(earliestA, earliestB);
    });

    // Each "block" here is one linked group's rows (normally 3) OR one
    // unlinked private track (a one-row block of its own) - block color and
    // the שעה קבוצתי merge both use this exact grouping. שעה פרטני is merged
    // SEPARATELY, scoped to just that block's own rows, so it only merges
    // truly-consecutive-identical private times within the block, never
    // spanning into a neighboring block.
    let colorIndex = 0;
    for (const groupId of orderedGroupIds) {
      const groupTrack = beginnerGroupById.get(groupId) ?? null;
      const linked = [...privateByGroupId.get(groupId)!].sort(compareLinkedPrivateTracks);
      const blockStartRow = rowIndex;
      const privateTimeRows: { rowIndex: number; value: string }[] = [];
      const groupTimeRows: { rowIndex: number; value: string }[] = [];
      for (const privateTrack of linked) {
        writeRow(sheet, rowIndex, buildBeginnerPrivateRow(privateTrack, groupTrack));
        privateTimeRows.push({ rowIndex, value: `${privateTrack.defaultStartTime}-${privateTrack.defaultEndTime}` });
        groupTimeRows.push({ rowIndex, value: groupTrack ? `${groupTrack.defaultStartTime}-${groupTrack.defaultEndTime}` : "—" });
        rowIndex += 1;
      }
      applyBlockFill(sheet, blockStartRow, rowIndex - 1, colorIndex, BEGINNER_HEADERS.length);
      colorIndex += 1;
      mergeConsecutiveEqualCells(sheet, 2, privateTimeRows); // שעה פרטני
      mergeConsecutiveEqualCells(sheet, 3, groupTimeRows); // שעה קבוצתי - whole block, same value throughout
    }
    for (const privateTrack of unlinked) {
      // A one-row block of its own (per the requirement that unlinked
      // private rows still get their own block color) - the merge helper
      // handles a single-row "run" fine, just centering it, no actual merge.
      writeRow(sheet, rowIndex, buildBeginnerPrivateRow(privateTrack, null));
      applyBlockFill(sheet, rowIndex, rowIndex, colorIndex, BEGINNER_HEADERS.length);
      colorIndex += 1;
      mergeConsecutiveEqualCells(sheet, 2, [{ rowIndex, value: `${privateTrack.defaultStartTime}-${privateTrack.defaultEndTime}` }]);
      mergeConsecutiveEqualCells(sheet, 3, [{ rowIndex, value: "—" }]);
      rowIndex += 1;
    }
    rowIndex += 1;
  }

  if (groupTracks.length === 0) {
    sheet.getCell(rowIndex, 1).value = `אין מבנה קבוע לקבוצה ${groupName}`;
  }
}

// One workbook, two sheets ("קבוצה א" / "קבוצה ב") - the fixed structure
// itself, never generated dated lessons, never feedback.
export async function buildTeachingPracticeFixedStructureWorkbook(
  tracks: TeachingPracticeTrackSummary[]
): Promise<Uint8Array> {
  const workbook = new Workbook();

  const sheetA = workbook.addWorksheet("קבוצה א", { views: [{ rightToLeft: true }] });
  buildSheetForGroup(sheetA, "א", tracks);

  const sheetB = workbook.addWorksheet("קבוצה ב", { views: [{ rightToLeft: true }] });
  buildSheetForGroup(sheetB, "ב", tracks);

  return workbookToBytes(workbook);
}
