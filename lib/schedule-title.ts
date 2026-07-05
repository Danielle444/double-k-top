// Some weekly-schedule Excel cells combine a time (often a special sub-range
// like a one-off מתודיקה slot that runs at a different time than the row's
// own start/end columns) together with the activity name in one cell, e.g.
// "16:00-16:45 מתודיקה" or "16:00 מתודיקה". A value like that should never
// surface as an item's displayed title - only the activity name should.
const LEADING_TIME_PATTERN = /^\s*\d{1,2}:\d{2}\s*(?:[-–]\s*\d{1,2}:\d{2})?\s*[-–:,]?\s*/;

export function cleanScheduleTitle(rawTitle: string): string {
  const trimmed = rawTitle.trim();
  if (!trimmed) return trimmed;
  const withoutLeadingTime = trimmed.replace(LEADING_TIME_PATTERN, "").trim();
  // If stripping the leading time left nothing, the whole cell was just a
  // time with no activity text to fall back to - use a neutral placeholder
  // rather than showing a bare time as the title.
  return withoutLeadingTime || "פעילות";
}

// Many schedule titles follow a "main activity - topic/details" structure,
// e.g. "מתודיקה - משוב", "רכיבה - ישיבה יציבה", "הרצאה - בטיחות". Students
// only need the main activity; instructors/admin keep seeing the full title.
// This must run *after* cleanScheduleTitle, so a leading time range (which
// also uses a dash) is already stripped before this splits on the real
// activity/topic separator.
export function getStudentScheduleTitle(title: string): string {
  const cleaned = cleanScheduleTitle(title);
  const [mainActivity] = cleaned.split(/[-–]/);
  return mainActivity.trim() || cleaned;
}
