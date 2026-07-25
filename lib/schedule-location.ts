// Trainee schedule card location label, DISPLAY-ONLY. Trims before rendering
// so a whitespace-only value (the admin editor's write path validates with a
// trimming Zod schema but persists the raw, untrimmed input - see
// lib/actions/schedule-items.ts) never renders as an empty "מיקום:" label
// with stray spacing. Returns null for null, empty, or whitespace-only
// location - never sourced from anywhere but the passed-in value.
export function formatScheduleLocationLabel(location: string | null): string | null {
  if (!location) return null;
  const trimmed = location.trim();
  return trimmed.length > 0 ? trimmed : null;
}
