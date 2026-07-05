// Shared by the student profile, admin horse-assignment page, and instructor
// horse-assignment tab, so the badge/label logic is identical everywhere.
export type HorseBadgeType = "private" | "assigned" | "none";

export interface HorseDisplayInfo {
  badgeType: HorseBadgeType;
  badgeLabel: string;
  horseName: string | null;
}

export interface HorseInfoInput {
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// "לא שובץ" isn't just the hasPrivateHorse=false-with-no-assignedHorseName
// case - it's whichever side is actually relevant for this student that
// turns out to have no name entered yet (a student marked as having a
// private horse but with no name recorded yet is still "not assigned",
// not silently shown as the other side's state).
export function getHorseDisplayInfo(student: HorseInfoInput): HorseDisplayInfo {
  if (student.hasPrivateHorse) {
    const name = student.privateHorseName?.trim() || null;
    if (!name) return { badgeType: "none", badgeLabel: "לא שובץ", horseName: null };
    return { badgeType: "private", badgeLabel: "סוס פרטי", horseName: name };
  }

  const name = student.assignedHorseName?.trim() || null;
  if (!name) return { badgeType: "none", badgeLabel: "לא שובץ", horseName: null };
  return { badgeType: "assigned", badgeLabel: "סוס קורס", horseName: name };
}
