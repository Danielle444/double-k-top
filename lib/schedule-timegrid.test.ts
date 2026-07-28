/**
 * IUS-2F - PURE-CORE tests for the timetable layout, focused on the new opt-in
 * long-gap compression plus the invariants it must not break.
 *
 * buildTimeGridLayout is DB-free, clock-free and React-free, so this is a real
 * behavioural test (not a source-contract one).
 *
 * Run with:
 *   npx tsx --test lib/schedule-timegrid.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTimeGridLayout,
  formatTimeGridGapDurationLabel,
  resolveTimeGridFullWidth,
} from "./schedule-timegrid";
import type { GroupableScheduleItem } from "./schedule-grouping";

function item(
  id: string,
  startTime: string,
  endTime: string,
  groupName: string | null = null,
  title = `activity-${id}`
): GroupableScheduleItem {
  return {
    id,
    startTime,
    endTime,
    title,
    groupName,
    instructorName: null,
    location: null,
    description: null,
  };
}

const COMPACT = { thresholdMinutes: 60, compressedSlotCount: 2 } as const;

/** Sorted, id-keyed projection so a test never depends on positions[] ordering. */
function byId(layout: ReturnType<typeof buildTimeGridLayout<GroupableScheduleItem>>) {
  return layout.positions
    .map((p) => ({
      ids: p.items.map((i) => i.id).join("+"),
      column: p.column,
      startSlotIndex: p.startSlotIndex,
      rowSpan: p.rowSpan,
    }))
    .sort((a, b) => a.ids.localeCompare(b.ids));
}

// ---------------------------------------------------------------------------
// (1)(2)(3)(4) Compaction OFF, and gaps that must stay proportional.
// ---------------------------------------------------------------------------

test("compact mode undefined leaves the existing output unchanged", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];
  const layout = buildTimeGridLayout(items);

  assert.equal(layout.totalSlots, 32, "08:00-16:00 = 8h = 32 slots, fully proportional");
  assert.equal(layout.slotMinutes, 15);
  assert.equal(layout.dayStartMinutes, 8 * 60);
  assert.deepEqual(layout.compressedGaps, [], "no config means no gap markers at all");
  assert.deepEqual(byId(layout), [
    { ids: "a", column: "a", startSlotIndex: 0, rowSpan: 4 },
    { ids: "b", column: "a", startSlotIndex: 28, rowSpan: 4 },
  ]);

  // The legacy positional call shape still works and is identical.
  assert.deepEqual(buildTimeGridLayout(items, 15), layout);
  assert.deepEqual(buildTimeGridLayout(items, { slotMinutes: 15 }), layout);
});

test("a single item produces no gap marker and the same totalSlots", () => {
  const items = [item("a", "08:00", "09:00", "א")];
  const off = buildTimeGridLayout(items);
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.equal(on.totalSlots, off.totalSlots);
  assert.equal(on.totalSlots, 4);
  assert.deepEqual(on.compressedGaps, []);
  assert.deepEqual(byId(on), byId(off));
});

test("a 45-minute gap is NOT compressed", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "09:45", "10:30", "א")];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.deepEqual(on.compressedGaps, []);
  assert.equal(on.totalSlots, 10, "08:00-10:30 = 150min = 10 slots stay proportional");
  assert.deepEqual(byId(on), byId(buildTimeGridLayout(items)));
});

test("an EXACTLY 60-minute gap is NOT compressed (strictly-greater boundary)", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "10:00", "11:00", "א")];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.deepEqual(on.compressedGaps, []);
  assert.equal(on.totalSlots, 12);
  assert.deepEqual(byId(on), byId(buildTimeGridLayout(items)));
});

// ---------------------------------------------------------------------------
// (5)(6)(7)(8)(9) Compaction ON.
// ---------------------------------------------------------------------------

test("a 75-minute gap compresses to compressedSlotCount rows", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "10:15", "11:00", "א")];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.equal(on.compressedGaps.length, 1);
  assert.equal(on.compressedGaps[0].rowSpan, 2);
  assert.equal(on.compressedGaps[0].realStartTime, "09:00");
  assert.equal(on.compressedGaps[0].realEndTime, "10:15");
  assert.equal(on.compressedGaps[0].realDurationMinutes, 75);
  assert.equal(on.compressedGaps[0].startSlotIndex, 4);
  assert.equal(on.totalSlots, 4 + 2 + 3, "4 + band + 45min item");
});

test("a six-hour gap compresses to compressedSlotCount rows and keeps its real duration", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.equal(on.compressedGaps.length, 1);
  const gap = on.compressedGaps[0];
  assert.equal(gap.realStartTime, "09:00");
  assert.equal(gap.realEndTime, "15:00");
  assert.equal(gap.realDurationMinutes, 360, "the REAL six hours survive compression");
  assert.equal(gap.startSlotIndex, 4);
  assert.equal(gap.rowSpan, 2);
  // The worked example from the slice brief: 4 + 2 + 4 = 10 rows.
  assert.equal(on.totalSlots, 10);
});

test("items after a compressed gap shift up, keeping rowSpan and their real times", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];
  const off = buildTimeGridLayout(items);
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  const offB = byId(off).find((p) => p.ids === "b")!;
  const onB = byId(on).find((p) => p.ids === "b")!;
  assert.equal(offB.startSlotIndex, 28);
  assert.equal(onB.startSlotIndex, 6, "immediately after the 2-row band");
  assert.equal(onB.rowSpan, offB.rowSpan, "an item's own duration is never compressed");

  const onA = byId(on).find((p) => p.ids === "a")!;
  assert.deepEqual(onA, byId(off).find((p) => p.ids === "a"), "items before a gap never move");

  // The item DATA the renderer prints is untouched - only coordinates changed.
  const rendered = on.positions.flatMap((p) => p.items).map((i) => `${i.id} ${i.startTime}-${i.endTime}`);
  assert.deepEqual(rendered.sort(), ["a 08:00-09:00", "b 15:00-16:00"]);
});

// ---------------------------------------------------------------------------
// (10)(11)(12)(13) Both columns share one timeline - occupancy is per ROW.
// ---------------------------------------------------------------------------

test("group א occupied while group ב is empty means the interval is OCCUPIED", () => {
  // א is busy 08:00-15:00; ב has a single item at each end. Nothing may compress.
  const items = [
    item("a1", "08:00", "15:00", "א"),
    item("b1", "08:00", "09:00", "ב"),
    item("b2", "14:00", "15:00", "ב"),
  ];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.deepEqual(on.compressedGaps, [], "group ב's idle hours are covered by group א");
  assert.equal(on.totalSlots, 28);
});

test("group ב occupied while group א is empty means the interval is OCCUPIED", () => {
  const items = [
    item("b1", "08:00", "15:00", "ב"),
    item("a1", "08:00", "09:00", "א"),
    item("a2", "14:00", "15:00", "א"),
  ];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.deepEqual(on.compressedGaps, []);
  assert.equal(on.totalSlots, 28);
});

test("parallel א/ב items stay aligned across a compressed gap", () => {
  const items = [
    item("a1", "08:00", "09:00", "א"),
    item("b1", "08:00", "09:00", "ב", "different-b"),
    item("a2", "15:00", "16:00", "א"),
    item("b2", "15:00", "16:00", "ב", "different-b2"),
  ];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });
  const p = byId(on);

  assert.equal(on.compressedGaps.length, 1);
  const a1 = p.find((x) => x.ids === "a1")!;
  const b1 = p.find((x) => x.ids === "b1")!;
  const a2 = p.find((x) => x.ids === "a2")!;
  const b2 = p.find((x) => x.ids === "b2")!;
  assert.deepEqual([a1.startSlotIndex, a1.rowSpan], [b1.startSlotIndex, b1.rowSpan]);
  assert.deepEqual([a2.startSlotIndex, a2.rowSpan], [b2.startSlotIndex, b2.rowSpan]);
  assert.equal(a1.column, "a");
  assert.equal(b1.column, "b");
  assert.equal(a2.startSlotIndex, 6);
});

test("a shared/full-width item counts as occupied", () => {
  const items = [
    item("a", "08:00", "09:00", "א"),
    item("shared", "09:00", "14:00", null),
    item("b", "14:00", "15:00", "א"),
  ];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.deepEqual(on.compressedGaps, [], "a both-columns item leaves no empty row");
  assert.equal(on.totalSlots, 28);
  assert.equal(byId(on).find((x) => x.ids === "shared")!.column, "both");
});

// ---------------------------------------------------------------------------
// (14)(15)(16)(17) Multiple gaps, mixed gaps, and the day's outer edges.
// ---------------------------------------------------------------------------

test("multiple qualifying gaps each compress independently", () => {
  const items = [
    item("a", "08:00", "09:00", "א"),
    item("b", "13:00", "14:00", "א"),
    item("c", "18:00", "19:00", "א"),
  ];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.equal(on.compressedGaps.length, 2);
  assert.deepEqual(
    on.compressedGaps.map((g) => [g.realStartTime, g.realEndTime, g.realDurationMinutes]),
    [
      ["09:00", "13:00", 240],
      ["14:00", "18:00", 240],
    ]
  );
  assert.deepEqual(on.compressedGaps.map((g) => [g.startSlotIndex, g.rowSpan]), [
    [4, 2],
    [10, 2],
  ]);
  assert.equal(on.totalSlots, 4 + 2 + 4 + 2 + 4);
  // Every compressed gap has an occupied item between it and the next one.
  const p = byId(on);
  assert.equal(p.find((x) => x.ids === "b")!.startSlotIndex, 6);
  assert.equal(p.find((x) => x.ids === "c")!.startSlotIndex, 12);
});

test("mixed short and long gaps compress only the long one", () => {
  const items = [
    item("a", "08:00", "09:00", "א"),
    item("b", "09:45", "10:30", "א"),
    item("c", "15:00", "16:00", "א"),
  ];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.equal(on.compressedGaps.length, 1);
  assert.equal(on.compressedGaps[0].realStartTime, "10:30");
  assert.equal(on.compressedGaps[0].realEndTime, "15:00");
  const p = byId(on);
  assert.equal(p.find((x) => x.ids === "a")!.startSlotIndex, 0);
  assert.equal(p.find((x) => x.ids === "b")!.startSlotIndex, 7, "the 45-min gap is still 3 rows");
  assert.equal(on.compressedGaps[0].startSlotIndex, 10);
  assert.equal(p.find((x) => x.ids === "c")!.startSlotIndex, 12);
});

test("empty time before the first item and after the last is never a gap marker", () => {
  // The axis is already trimmed to [earliest start, latest end], so the only
  // way to assert this is that a two-item day yields exactly ONE marker, not
  // three, and the outer rows are the items themselves.
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.equal(on.compressedGaps.length, 1);
  assert.ok(on.compressedGaps[0].startSlotIndex > 0, "no marker may start at row 0");
  const last = on.compressedGaps[0].startSlotIndex + on.compressedGaps[0].rowSpan;
  assert.ok(last < on.totalSlots, "no marker may reach the final row");
});

test("a lone item at each edge of a compressed day keeps the day's real bounds", () => {
  const items = [item("a", "06:30", "07:00", "ב"), item("b", "20:00", "21:00", "ב")];
  const on = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  assert.equal(on.dayStartMinutes, 6 * 60 + 30, "the real day start is preserved");
  assert.equal(on.compressedGaps[0].realStartTime, "07:00");
  assert.equal(on.compressedGaps[0].realEndTime, "20:00");
  assert.equal(on.compressedGaps[0].realDurationMinutes, 13 * 60);
  assert.equal(on.totalSlots, 2 + 2 + 4);
});

// ---------------------------------------------------------------------------
// (18)(19)(20)(21)(22) Purity, determinism, ids, slotMinutes, bad config.
// ---------------------------------------------------------------------------

test("the input array and its items are not mutated", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];
  const snapshot = JSON.parse(JSON.stringify(items));
  buildTimeGridLayout(items, { compactLongGaps: COMPACT });
  assert.deepEqual(items, snapshot);
  assert.equal(items.length, 2);
});

test("output is deterministic under equivalent input ordering", () => {
  const a = item("a", "08:00", "09:00", "א");
  const b = item("b", "08:00", "09:00", "ב", "other");
  const c = item("c", "15:00", "16:00", "א");

  const one = buildTimeGridLayout([a, b, c], { compactLongGaps: COMPACT });
  const two = buildTimeGridLayout([c, b, a], { compactLongGaps: COMPACT });

  assert.deepEqual(one.compressedGaps, two.compressedGaps);
  assert.equal(one.totalSlots, two.totalSlots);
  assert.equal(one.dayStartMinutes, two.dayStartMinutes);
  assert.deepEqual(byId(one), byId(two));
});

test("compressed-gap ids are stable and derived from the real times", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];
  const first = buildTimeGridLayout(items, { compactLongGaps: COMPACT });
  const second = buildTimeGridLayout([...items].reverse(), { compactLongGaps: COMPACT });

  assert.equal(first.compressedGaps[0].id, "gap-09:00-15:00");
  assert.equal(first.compressedGaps[0].id, second.compressedGaps[0].id);

  const multi = buildTimeGridLayout(
    [item("a", "08:00", "09:00", "א"), item("b", "13:00", "14:00", "א"), item("c", "18:00", "19:00", "א")],
    { compactLongGaps: COMPACT }
  );
  assert.equal(new Set(multi.compressedGaps.map((g) => g.id)).size, 2, "ids are unique within a day");
});

test("a custom slotMinutes still works, with and without compaction", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];

  const off = buildTimeGridLayout(items, { slotMinutes: 30 });
  assert.equal(off.slotMinutes, 30);
  assert.equal(off.totalSlots, 16);
  assert.deepEqual(off.compressedGaps, []);

  const on = buildTimeGridLayout(items, { slotMinutes: 30, compactLongGaps: COMPACT });
  assert.equal(on.slotMinutes, 30);
  assert.equal(on.compressedGaps.length, 1);
  assert.equal(on.compressedGaps[0].realDurationMinutes, 360);
  assert.equal(on.totalSlots, 2 + 2 + 2, "2 + band + 2 at 30-minute slots");
  assert.equal(byId(on).find((x) => x.ids === "b")!.startSlotIndex, 4);
});

test("an invalid compact config is safely ignored, never thrown", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "א")];
  const baseline = buildTimeGridLayout(items);

  for (const bad of [
    { thresholdMinutes: 0, compressedSlotCount: 2 },
    { thresholdMinutes: -60, compressedSlotCount: 2 },
    { thresholdMinutes: 60, compressedSlotCount: 0 },
    { thresholdMinutes: 60, compressedSlotCount: -2 },
    { thresholdMinutes: Number.NaN, compressedSlotCount: 2 },
    { thresholdMinutes: 60, compressedSlotCount: Number.POSITIVE_INFINITY },
  ]) {
    const layout = buildTimeGridLayout(items, { compactLongGaps: bad });
    assert.deepEqual(layout.compressedGaps, [], `${JSON.stringify(bad)} must disable compaction`);
    assert.equal(layout.totalSlots, baseline.totalSlots, `${JSON.stringify(bad)} must not resize the grid`);
    assert.deepEqual(byId(layout), byId(baseline));
  }
});

test("compaction never makes a gap taller than it really is", () => {
  // 75 minutes = 5 rows; asking for a 12-row band must leave it proportional.
  const items = [item("a", "08:00", "09:00", "א"), item("b", "10:15", "11:00", "א")];
  const layout = buildTimeGridLayout(items, {
    compactLongGaps: { thresholdMinutes: 60, compressedSlotCount: 12 },
  });
  assert.deepEqual(layout.compressedGaps, []);
  assert.equal(layout.totalSlots, buildTimeGridLayout(items).totalSlots);
});

test("an empty day returns an empty layout in both modes", () => {
  assert.deepEqual(buildTimeGridLayout([]), {
    totalSlots: 0,
    slotMinutes: 15,
    dayStartMinutes: 0,
    positions: [],
    compressedGaps: [],
  });
  assert.deepEqual(buildTimeGridLayout([], { compactLongGaps: COMPACT }).compressedGaps, []);
});

// ---------------------------------------------------------------------------
// Accessible duration wording.
// ---------------------------------------------------------------------------

test("the gap duration is spelled out in Hebrew for assistive tech", () => {
  assert.equal(formatTimeGridGapDurationLabel(360), "6 שעות");
  assert.equal(formatTimeGridGapDurationLabel(120), "שעתיים");
  assert.equal(formatTimeGridGapDurationLabel(60), "שעה אחת");
  assert.equal(formatTimeGridGapDurationLabel(75), "שעה אחת ו-15 דקות");
  assert.equal(formatTimeGridGapDurationLabel(45), "45 דקות");
  assert.equal(formatTimeGridGapDurationLabel(1), "דקה אחת");
  assert.equal(formatTimeGridGapDurationLabel(0), "0 דקות");
});

// ===========================================================================
// IUS-3B - SINGLE ASSIGNED GROUP MAY USE THE FULL WIDTH
//
// The decision unit is ONE CELL over ITS OWN EXACT ROW RANGE, never the whole
// grid: a grid that contains group א at 08:00 and group ב at 12:00 contains both
// groups but never needs two columns at the same time.
//
// The column TEMPLATE is not part of this behaviour and is deliberately not
// touched - widening is expressed purely as a cell spanning both columns, which
// is what a "שתי הקבוצות" cell has always done.
// ===========================================================================

const EXPAND = { expandUnopposedGroupItems: true } as const;

/** byId plus the full-width decision, for the IUS-3B cases. */
function widthById(layout: ReturnType<typeof buildTimeGridLayout<GroupableScheduleItem>>) {
  return layout.positions
    .map((p) => ({
      ids: p.items.map((i) => i.id).join("+"),
      column: p.column,
      fullWidth: p.fullWidth,
      startSlotIndex: p.startSlotIndex,
      rowSpan: p.rowSpan,
    }))
    .sort((a, b) => a.ids.localeCompare(b.ids));
}

// ---------------------------------------------------------------------------
// (23) DEFAULT OFF - existing callers keep the exact current layout.
// ---------------------------------------------------------------------------

test("the option absent leaves a lone group א day at half width, as today", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "ב")];

  for (const layout of [
    buildTimeGridLayout(items),
    buildTimeGridLayout(items, 15),
    buildTimeGridLayout(items, { slotMinutes: 15 }),
    buildTimeGridLayout(items, { expandUnopposedGroupItems: false }),
  ]) {
    assert.deepEqual(widthById(layout), [
      { ids: "a", column: "a", fullWidth: false, startSlotIndex: 0, rowSpan: 4 },
      { ids: "b", column: "b", fullWidth: false, startSlotIndex: 28, rowSpan: 4 },
    ]);
  }
});

test("with the option off, fullWidth is exactly the pre-IUS-3B rule (column === both)", () => {
  const items = [
    item("a", "08:00", "09:00", "א"),
    item("b", "10:00", "11:00", "ב"),
    item("shared", "12:00", "13:00", null),
  ];
  for (const p of buildTimeGridLayout(items).positions) {
    assert.equal(p.fullWidth, p.column === "both", `${p.items[0].id} must keep today's span`);
  }
});

// ---------------------------------------------------------------------------
// (24)(25) A lone group uses the full width.
// ---------------------------------------------------------------------------

test("a lone group א item uses the full width", () => {
  const layout = buildTimeGridLayout([item("a", "08:00", "09:00", "א")], EXPAND);
  assert.deepEqual(widthById(layout), [
    { ids: "a", column: "a", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
  ]);
});

test("a lone group ב item uses the full width", () => {
  const layout = buildTimeGridLayout([item("b", "08:00", "09:00", "ב")], EXPAND);
  assert.deepEqual(widthById(layout), [
    { ids: "b", column: "b", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
  ]);
});

test("a whole day of group א only widens every card, without changing the axis", () => {
  const items = [
    item("a1", "08:00", "09:00", "א"),
    item("a2", "10:00", "11:30", "א"),
    item("a3", "13:00", "14:00", "א"),
  ];
  const off = buildTimeGridLayout(items);
  const on = buildTimeGridLayout(items, EXPAND);

  assert.equal(on.totalSlots, off.totalSlots, "the axis is untouched");
  assert.equal(on.dayStartMinutes, off.dayStartMinutes);
  assert.ok(
    widthById(on).every((p) => p.fullWidth),
    "nothing opposes any of them, so all three use the full width"
  );
  // Row placement and duration spans are identical to the un-widened layout.
  assert.deepEqual(
    widthById(on).map(({ ids, startSlotIndex, rowSpan }) => ({ ids, startSlotIndex, rowSpan })),
    widthById(off).map(({ ids, startSlotIndex, rowSpan }) => ({ ids, startSlotIndex, rowSpan }))
  );
});

// ---------------------------------------------------------------------------
// (26)(27) Genuine side-by-side survives, including partial overlap.
// ---------------------------------------------------------------------------

test("simultaneous א/ב items stay in two columns", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "08:00", "09:00", "ב", "other")];
  const layout = buildTimeGridLayout(items, EXPAND);

  assert.deepEqual(widthById(layout), [
    { ids: "a", column: "a", fullWidth: false, startSlotIndex: 0, rowSpan: 4 },
    { ids: "b", column: "b", fullWidth: false, startSlotIndex: 0, rowSpan: 4 },
  ]);
});

test("a PARTIAL overlap blocks widening for BOTH cards", () => {
  // א 08:00-10:00 is opposed only during 09:00-09:30 - but a card is one
  // rectangle and cannot be half-width for part of its duration.
  const items = [item("a", "08:00", "10:00", "א"), item("b", "09:00", "09:30", "ב", "other")];
  const layout = buildTimeGridLayout(items, EXPAND);

  assert.deepEqual(widthById(layout), [
    { ids: "a", column: "a", fullWidth: false, startSlotIndex: 0, rowSpan: 8 },
    { ids: "b", column: "b", fullWidth: false, startSlotIndex: 4, rowSpan: 2 },
  ]);
});

test("opposite-column occupancy on a SINGLE row anywhere in the range blocks widening", () => {
  // One 15-minute ב item against a two-hour א item: the minimum possible
  // opposition, on exactly one row, must still be enough.
  const items = [item("a", "08:00", "10:00", "א"), item("b", "09:45", "10:00", "ב", "other")];
  const layout = buildTimeGridLayout(items, EXPAND);
  const a = widthById(layout).find((p) => p.ids === "a")!;

  assert.equal(a.rowSpan, 8);
  assert.equal(a.fullWidth, false, "one opposed row out of eight is enough");

  // Move that same ב item just past א's end and א widens - proving the rule is
  // measured over the range, not over the day.
  const clear = buildTimeGridLayout(
    [item("a", "08:00", "10:00", "א"), item("b", "10:00", "10:15", "ב", "other")],
    EXPAND
  );
  assert.equal(clear.positions.every((p) => p.fullWidth), true);
});

// ---------------------------------------------------------------------------
// (28)(29) Non-simultaneous cards widen INDEPENDENTLY - the case a per-grid
// rule gets wrong.
// ---------------------------------------------------------------------------

test("group א at 08:00 and group ב at 12:00 BOTH widen", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "12:00", "13:00", "ב")];
  const off = buildTimeGridLayout(items);
  const on = buildTimeGridLayout(items, EXPAND);

  assert.deepEqual(widthById(on), [
    { ids: "a", column: "a", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
    { ids: "b", column: "b", fullWidth: true, startSlotIndex: 16, rowSpan: 4 },
  ]);
  // Both groups are present in the grid, so a per-grid rule would have kept two
  // columns and left two permanently blank halves. The real vertical distance
  // between them is unchanged either way.
  assert.equal(on.totalSlots, off.totalSlots);
  assert.deepEqual(
    widthById(off).map((p) => [p.startSlotIndex, p.rowSpan]),
    widthById(on).map((p) => [p.startSlotIndex, p.rowSpan])
  );
});

test("back-to-back א then ב (touching, not overlapping) both widen", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "09:00", "10:00", "ב")];
  const layout = buildTimeGridLayout(items, EXPAND);

  assert.deepEqual(widthById(layout), [
    { ids: "a", column: "a", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
    { ids: "b", column: "b", fullWidth: true, startSlotIndex: 4, rowSpan: 4 },
  ]);
});

test("one widened and one opposed pair coexist in the same grid", () => {
  const items = [
    // 08:00-09:00: א only -> widens.
    item("a1", "08:00", "09:00", "א"),
    // 10:00-11:00: genuinely simultaneous -> two columns.
    item("a2", "10:00", "11:00", "א"),
    item("b2", "10:00", "11:00", "ב", "other"),
  ];
  const layout = buildTimeGridLayout(items, EXPAND);

  assert.deepEqual(widthById(layout), [
    { ids: "a1", column: "a", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
    { ids: "a2", column: "a", fullWidth: false, startSlotIndex: 8, rowSpan: 4 },
    { ids: "b2", column: "b", fullWidth: false, startSlotIndex: 8, rowSpan: 4 },
  ]);
});

// ---------------------------------------------------------------------------
// (30)(31) Shared / non-group items keep their current behaviour.
// ---------------------------------------------------------------------------

test("a שתי הקבוצות item spans both columns with and without the option", () => {
  const items = [item("shared", "08:00", "09:00", null)];
  for (const layout of [buildTimeGridLayout(items), buildTimeGridLayout(items, EXPAND)]) {
    assert.deepEqual(widthById(layout), [
      { ids: "shared", column: "both", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
    ]);
  }
});

test("an unrecognised group value keeps its current full-width behaviour", () => {
  // Anything that is not "א"/"ב" has always been treated as "both". Missing or
  // unexpected group information must therefore fail safe to today's layout.
  for (const group of [null, "", "שתי הקבוצות", "ג"]) {
    const items = [item("x", "08:00", "09:00", group)];
    const off = buildTimeGridLayout(items);
    const on = buildTimeGridLayout(items, EXPAND);
    assert.deepEqual(widthById(on), widthById(off), `group ${JSON.stringify(group)} must be unchanged`);
    assert.equal(on.positions[0].column, "both");
    assert.equal(on.positions[0].fullWidth, true);
  }
});

test("the existing exact-same-activity א+ב merge still yields ONE full-width card", () => {
  const items = [item("a", "08:00", "09:00", "א", "ride"), item("b", "08:00", "09:00", "ב", "ride")];
  const off = buildTimeGridLayout(items);
  const on = buildTimeGridLayout(items, EXPAND);

  assert.equal(on.positions.length, 1, "the merge step ran before positioning, as before");
  assert.deepEqual(widthById(on), widthById(off));
  assert.deepEqual(widthById(on), [
    { ids: "a+b", column: "both", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
  ]);
});

test("a shared item blocks an overlapping א item from widening into its rows", () => {
  // A "both" cell already covers both columns, so widening the א cell here would
  // paint the two over each other.
  const items = [item("shared", "08:00", "09:00", null), item("a", "08:00", "09:00", "א", "other")];
  const layout = buildTimeGridLayout(items, EXPAND);

  assert.deepEqual(widthById(layout), [
    { ids: "a", column: "a", fullWidth: false, startSlotIndex: 0, rowSpan: 4 },
    { ids: "shared", column: "both", fullWidth: true, startSlotIndex: 0, rowSpan: 4 },
  ]);
});

// ---------------------------------------------------------------------------
// (32)(33)(34) Coalescing, spans and same-column overlap stacking.
// ---------------------------------------------------------------------------

test("a coalesced same-title run is measured over its MERGED range", () => {
  const contiguous = [
    item("a1", "08:00", "09:00", "א", "ride"),
    item("a2", "09:00", "10:00", "א", "ride"),
  ];

  const alone = buildTimeGridLayout(contiguous, EXPAND);
  assert.equal(alone.positions.length, 1, "coalescing still runs first");
  assert.deepEqual(widthById(alone), [
    { ids: "a1+a2", column: "a", fullWidth: true, startSlotIndex: 0, rowSpan: 8 },
  ]);

  // A ב item inside the SECOND half of the merged range still blocks it, because
  // the decision is taken on the merged 08:00-10:00 rectangle.
  const opposed = buildTimeGridLayout(
    [...contiguous, item("b", "09:30", "10:00", "ב", "other")],
    EXPAND
  );
  assert.equal(widthById(opposed).find((p) => p.ids === "a1+a2")!.fullWidth, false);
});

test("span layout (one long א against two short ב) keeps two columns throughout", () => {
  const items = [
    item("long", "10:00", "12:00", "א", "long-ride"),
    item("s1", "10:00", "11:00", "ב", "s1"),
    item("s2", "11:00", "12:00", "ב", "s2"),
  ];
  const off = buildTimeGridLayout(items);
  const on = buildTimeGridLayout(items, EXPAND);

  assert.equal(on.positions.every((p) => !p.fullWidth), true, "nothing may widen here");
  assert.deepEqual(widthById(on), widthById(off), "the span geometry is byte-identical");
  assert.deepEqual(widthById(on), [
    { ids: "long", column: "a", fullWidth: false, startSlotIndex: 0, rowSpan: 8 },
    { ids: "s1", column: "b", fullWidth: false, startSlotIndex: 0, rowSpan: 4 },
    { ids: "s2", column: "b", fullWidth: false, startSlotIndex: 4, rowSpan: 4 },
  ]);
});

test("a same-column overlap stack widens only if the opposite column is clear across its union", () => {
  const overlapping = [
    item("a1", "08:00", "10:00", "א", "one"),
    item("a2", "09:00", "11:00", "א", "two"),
  ];

  const clear = buildTimeGridLayout(overlapping, EXPAND);
  assert.equal(clear.positions.length, 1, "the two overlapping cells still share ONE stacked cell");
  assert.deepEqual(widthById(clear), [
    { ids: "a1+a2", column: "a", fullWidth: true, startSlotIndex: 0, rowSpan: 12 },
  ]);

  // One ב item anywhere inside the 08:00-11:00 union blocks the whole stack.
  const opposed = buildTimeGridLayout(
    [...overlapping, item("b", "10:30", "11:00", "ב", "other")],
    EXPAND
  );
  const stack = widthById(opposed).find((p) => p.ids === "a1+a2")!;
  assert.equal(stack.rowSpan, 12, "the stacked cell's union is unchanged");
  assert.equal(stack.fullWidth, false);
});

// ---------------------------------------------------------------------------
// (35)(36)(37) Group identity, purity, determinism, and IUS-2F interaction.
// ---------------------------------------------------------------------------

test("widening NEVER rewrites a cell's column - the group is preserved", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "12:00", "13:00", "ב")];
  const on = buildTimeGridLayout(items, EXPAND);

  assert.equal(on.positions.every((p) => p.fullWidth), true);
  assert.deepEqual(
    widthById(on).map((p) => p.column),
    widthById(buildTimeGridLayout(items)).map((p) => p.column),
    "a widened cell keeps reporting its real group column"
  );
  // And the underlying items are untouched, so the card's own group badge and
  // colour still say which group it is.
  assert.deepEqual(
    on.positions.flatMap((p) => p.items).map((i) => i.groupName).sort(),
    ["א", "ב"]
  );
});

test("the option does not mutate the input and is order-independent", () => {
  const items = [
    item("a", "08:00", "09:00", "א"),
    item("b", "12:00", "13:00", "ב"),
    item("shared", "15:00", "16:00", null),
  ];
  const snapshot = JSON.parse(JSON.stringify(items));

  const one = buildTimeGridLayout(items, EXPAND);
  assert.deepEqual(items, snapshot, "neither the array nor any item is mutated");

  const two = buildTimeGridLayout([...items].reverse(), EXPAND);
  assert.deepEqual(widthById(one), widthById(two));
});

test("the decision is taken on the REAL axis and survives gap compression", () => {
  const items = [item("a", "08:00", "09:00", "א"), item("b", "15:00", "16:00", "ב")];

  const expanded = buildTimeGridLayout(items, EXPAND);
  const both = buildTimeGridLayout(items, { ...EXPAND, compactLongGaps: COMPACT });
  const compactedOnly = buildTimeGridLayout(items, { compactLongGaps: COMPACT });

  // Same decisions with and without compaction - a collapsed row can never be
  // read as an unoccupied one.
  assert.deepEqual(
    widthById(both).map(({ ids, column, fullWidth }) => ({ ids, column, fullWidth })),
    widthById(expanded).map(({ ids, column, fullWidth }) => ({ ids, column, fullWidth }))
  );
  assert.equal(both.positions.every((p) => p.fullWidth), true);
  // Compaction itself is unaffected: same band, same rows as without the option.
  assert.deepEqual(both.compressedGaps, compactedOnly.compressedGaps);
  assert.equal(both.totalSlots, compactedOnly.totalSlots);
  assert.deepEqual(
    widthById(both).map((p) => [p.startSlotIndex, p.rowSpan]),
    widthById(compactedOnly).map((p) => [p.startSlotIndex, p.rowSpan])
  );
});

// ---------------------------------------------------------------------------
// (38) The pure helper on its own, including its fail-safe paths.
// ---------------------------------------------------------------------------

test("resolveTimeGridFullWidth returns one decision per cell, in input order", () => {
  const cells = [
    { column: "a" as const, startSlotIndex: 0, rowSpan: 4 },
    { column: "b" as const, startSlotIndex: 0, rowSpan: 4 },
    { column: "a" as const, startSlotIndex: 8, rowSpan: 4 },
    { column: "both" as const, startSlotIndex: 16, rowSpan: 4 },
  ];
  assert.deepEqual(resolveTimeGridFullWidth(cells, 20), [false, false, true, true]);
  // Pure: the input is not mutated.
  assert.deepEqual(cells[0], { column: "a", startSlotIndex: 0, rowSpan: 4 });
});

test("resolveTimeGridFullWidth fails safe to the current layout on a bad axis", () => {
  const cells = [
    { column: "a" as const, startSlotIndex: 0, rowSpan: 4 },
    { column: "both" as const, startSlotIndex: 0, rowSpan: 4 },
  ];
  for (const totalSlots of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(
      resolveTimeGridFullWidth(cells, totalSlots),
      [false, true],
      `totalSlots ${totalSlots} must fall back to column === "both"`
    );
  }
  assert.deepEqual(resolveTimeGridFullWidth([], 10), []);
});

test("resolveTimeGridFullWidth never widens a cell with no measurable rows", () => {
  assert.deepEqual(
    resolveTimeGridFullWidth([{ column: "a", startSlotIndex: 4, rowSpan: 0 }], 10),
    [false],
    "no rows means no evidence, so keep today's half width"
  );
  assert.deepEqual(
    resolveTimeGridFullWidth([{ column: "b", startSlotIndex: 40, rowSpan: 4 }], 10),
    [false],
    "a range entirely outside the axis is never widened"
  );
});
