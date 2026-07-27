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
import { buildTimeGridLayout, formatTimeGridGapDurationLabel } from "./schedule-timegrid";
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
