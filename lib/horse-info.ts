// Shared by the student profile, admin horse-assignment page, and instructor
// horse-assignment tab, so the badge/label logic is identical everywhere.
export type HorseBadgeType = "private" | "assigned" | "none";

export interface HorseDisplayInfo {
  badgeType: HorseBadgeType;
  badgeLabel: string;
  // Raw name as entered, or null if none was entered - use this for search/matching.
  horseName: string | null;
  // Always non-empty - the real name, or a placeholder when none was entered.
  // Use this for rendering so a private/assigned horse with no name yet
  // still reads clearly instead of rendering nothing.
  horseNameDisplay: string;
}

export interface HorseInfoInput {
  hasPrivateHorse: boolean;
  privateHorseName: string | null;
  assignedHorseName: string | null;
}

// Status depends only on hasPrivateHorse (and, when false, on whether a
// course horse was assigned) - never on whether a name string happens to be
// filled in. An admin can mark a student as having a private horse before
// they know its name; that student must still show as "סוס פרטי", not
// silently fall back to "לא שובץ".
export function getHorseDisplayInfo(student: HorseInfoInput): HorseDisplayInfo {
  if (student.hasPrivateHorse) {
    const name = student.privateHorseName?.trim() || null;
    return {
      badgeType: "private",
      badgeLabel: "סוס פרטי",
      horseName: name,
      horseNameDisplay: name ?? "שם סוס לא הוזן",
    };
  }

  const name = student.assignedHorseName?.trim() || null;
  if (!name) {
    return {
      badgeType: "none",
      badgeLabel: "לא שובץ",
      horseName: null,
      horseNameDisplay: "לא שובץ סוס",
    };
  }
  return {
    badgeType: "assigned",
    badgeLabel: "סוס קורס",
    horseName: name,
    horseNameDisplay: name,
  };
}
