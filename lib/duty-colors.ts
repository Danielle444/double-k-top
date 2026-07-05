// Shared between the Excel export (lib/exports/build-schedule-workbook.ts)
// and the admin schedule grid (app/admin/schedule/ScheduleGrid.tsx) so a
// duty type always renders with the same color everywhere.

export interface DutyColor {
  background: string;
  border: string;
}

// Light pastel backgrounds, each paired with a slightly more saturated
// border shade - dark default text (already used across the app) stays
// readable on all of these. Sized well above the current duty type count
// (10) so distinct duty types get distinct colors with headroom to add more.
const PALETTE: DutyColor[] = [
  { background: "#DCEEF7", border: "#9CC9E3" }, // light blue
  { background: "#E3F5E1", border: "#A9DDA4" }, // light green
  { background: "#FCEBD5", border: "#F0C48A" }, // light orange
  { background: "#F3E1F5", border: "#D6A8DE" }, // light purple
  { background: "#FDE8E8", border: "#F0A9A9" }, // light pink/red
  { background: "#FFF6D6", border: "#EAD98A" }, // light yellow
  { background: "#E1F0EF", border: "#9FD2CE" }, // light teal
  { background: "#EEEAF6", border: "#C3B7E0" }, // light indigo
  { background: "#F6E9DE", border: "#DDB99B" }, // light tan
  { background: "#E7F0DA", border: "#B9D48F" }, // light olive
  { background: "#E9F2FB", border: "#B6D4EF" }, // pale sky blue
  { background: "#FBEAF0", border: "#EFB9CE" }, // pale rose
  { background: "#F0F2DC", border: "#D3D89E" }, // pale chartreuse
  { background: "#E4F6F1", border: "#A6E0CE" }, // pale mint
  { background: "#F7E9F7", border: "#E3B8E3" }, // pale orchid
  { background: "#FDF0E1", border: "#F0CE9E" }, // pale peach
];

const NO_DUTY_COLOR: DutyColor = { background: "#EEEEEE", border: "#CCCCCC" };
// Matches the app's existing --color-warning-muted token, so this reads as
// the same "heads up" tone used elsewhere in the admin UI.
const COVERAGE_WARNING_COLOR: DutyColor = { background: "#FEF3C7", border: "#E0B84A" };
// Matches --color-danger-muted - used for "overfilled/duplicate" cases,
// which read as more of a real problem than a plain shortfall.
const OVERFILLED_WARNING_COLOR: DutyColor = { background: "#FEE2E2", border: "#F0A9A9" };

export function getNoDutyColor(): DutyColor {
  return NO_DUTY_COLOR;
}

export function getCoverageWarningColor(): DutyColor {
  return COVERAGE_WARNING_COLOR;
}

export function getOverfilledWarningColor(): DutyColor {
  return OVERFILLED_WARNING_COLOR;
}

// Deterministic, order-based assignment: sort the given duty type ids (a
// plain string sort - stable and identical every time for the same set) and
// hand out palette colors in that order. As long as there are no more duty
// types than palette entries (currently 16, comfortably above the real
// count), every duty type in the set gets a distinct color.
//
// Trade-off worth knowing: because the color depends on *where a duty type
// falls in the current active set*, adding/removing/deactivating a duty
// type can shift the colors of other duty types too. That's the price of
// guaranteeing uniqueness from a fixed light-pastel palette rather than a
// pure per-id hash (which never collides less reliably, but also never
// guarantees distinctness). Both the Excel export and the admin grid build
// this map from the same "active duty types" query, so they always agree.
export function buildDutyColorMap(dutyTypeIds: string[]): Map<string, DutyColor> {
  const sortedIds = [...new Set(dutyTypeIds)].sort();
  const map = new Map<string, DutyColor>();
  sortedIds.forEach((id, index) => {
    map.set(id, PALETTE[index % PALETTE.length]);
  });
  return map;
}
