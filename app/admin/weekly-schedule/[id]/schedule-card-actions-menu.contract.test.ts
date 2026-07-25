/**
 * ADMIN SCHEDULE CARD ACTIONS MENU - contract tests for the compact "⋯"
 * actions trigger that replaced the inline עריכה/ניהול רכיבה/מחיקה button
 * cluster on the admin weekly-schedule editor card.
 *
 * WeeklyScheduleDetailClient.tsx is the ONLY admin component that renders
 * this cluster (confirmed by audit: WeeklyRidingClient.tsx, the other admin
 * week route under /riding, only has a bulk ניהול רכיבה flow with no
 * per-card edit/delete/riding cluster). Both the compact grid view (all
 * groups, ScheduleTimeGrid - fixed-height, overflow-hidden cells that can
 * clip a short session) and the non-compact single-group list render through
 * the SAME ScheduleCard component and the SAME trigger, so neither depends
 * on card height to decide whether the controls exist.
 *
 * WHY SOURCE-CONTRACT, NOT AN IMPORTED UNIT TEST
 * ----------------------------------------------
 * WeeklyScheduleDetailClient.tsx transitively imports lib/actions/schedule-items.ts
 * and lib/actions/no-duty-dates.ts, both "use server" modules (Prisma), so it
 * cannot be imported into a plain `tsx --test` process. This mirrors the
 * repository's established SOURCE-CONTRACT pattern (see
 * app/instructor/instructor-schedule-card-info-details.contract.test.ts).
 *
 * Run with:
 *   npx tsx --test "app/admin/weekly-schedule/[id]/schedule-card-actions-menu.contract.test.ts"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
}

const SECTION = readSource("./WeeklyScheduleDetailClient.tsx");

function cardComponentSource(): string {
  const start = SECTION.indexOf("function ScheduleCard(");
  const end = SECTION.indexOf("export function WeeklyScheduleDetailClient(");
  assert.notEqual(start, -1, "expected the ScheduleCard component");
  assert.ok(end > start);
  return SECTION.slice(start, end);
}

// ---------------------------------------------------------------------------
// Reuses the app's existing Modal - no new UI library, no bespoke dialog.
// ---------------------------------------------------------------------------

test("the admin schedule card reuses the shared Modal component for its actions menu", () => {
  assert.match(SECTION, /import\s*\{\s*Modal\s*\}\s*from\s*"@\/lib\/components\/Modal";/);
  const card = cardComponentSource();
  assert.ok(card.includes('<Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="פעולות לסשן">'));
});

// ---------------------------------------------------------------------------
// The trigger always exists, on every card, regardless of height/compact mode.
// ---------------------------------------------------------------------------

test("the actions trigger is unconditional - not gated on compact, height, or any secondary-detail check", () => {
  const card = cardComponentSource();
  // Exactly one button element in this component: the trigger. No `compact &&`
  // or similar guard wraps it (unlike the instructor info button, which is
  // conditionally gated - here the trigger must always be present).
  const btnCount = (card.match(/<button/g) ?? []).length;
  assert.equal(btnCount, 1, "expected exactly one <button> - the always-present actions trigger");
  assert.ok(!/getBoundingClientRect|ResizeObserver|scrollHeight|offsetHeight/.test(SECTION), "must not use fragile DOM overflow measurement");
});

test("the trigger is a real, keyboard-accessible button with the required Hebrew aria-label", () => {
  const card = cardComponentSource();
  const btnStart = card.indexOf("<button");
  const btnEnd = card.indexOf("</button>", btnStart);
  const btn = card.slice(btnStart, btnEnd);
  assert.ok(btn.includes('type="button"'));
  assert.ok(btn.includes('aria-label="פעולות לסשן"'));
});

test("the trigger stops propagation on click and keydown", () => {
  const card = cardComponentSource();
  const btnStart = card.indexOf("<button");
  const btnEnd = card.indexOf("</button>", btnStart);
  const btn = card.slice(btnStart, btnEnd);
  assert.ok(btn.includes("e.stopPropagation()"), "expected stopPropagation in the onClick handler");
  assert.ok(btn.includes("onKeyDown={(e) => e.stopPropagation()}"));
});

test("the trigger sits on the header row (time/tag line), not gated by compact - never clipped by the grid cell's overflow-hidden", () => {
  const card = cardComponentSource();
  const headerStart = card.indexOf("<div\n        className={");
  const headerEnd = card.indexOf("</div>", card.indexOf("</button>"));
  assert.notEqual(headerStart, -1);
  const header = card.slice(headerStart, headerEnd);
  assert.ok(header.includes(`{item.startTime}-{item.endTime}`));
  assert.ok(header.includes("aria-label=\"פעולות לסשן\""), "expected the trigger inside the same header row as time/tag");
});

// ---------------------------------------------------------------------------
// Existing handlers/behavior preserved exactly - no new handlers, no
// duplicated logic, no changed arguments.
// ---------------------------------------------------------------------------

test("the edit action still calls the existing onEdit(item) handler unchanged", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("onEdit(item);"), "expected onEdit invoked with the untouched item (composite id included)");
  assert.ok(card.includes(">עריכה</Button>") || /עריכה\s*<\/Button>/.test(card));
});

test("the riding-management action still calls the existing onManageRiding(item) handler unchanged", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("onManageRiding(item);"));
  assert.ok(/ניהול רכיבה\s*<\/Button>/.test(card));
});

test("the delete action still calls the existing onDelete(item) handler, which drives the pre-existing confirmation modal - no new confirmation logic here", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("onDelete(item);"));
  assert.ok(/מחיקה\s*<\/Button>/.test(card));
  // The confirmation itself (deleteTarget state + confirm Modal) lives in the
  // parent component and must be untouched by this change.
  assert.match(SECTION, /setDeleteTarget\(item\)/);
  assert.match(SECTION, /handleConfirmDelete/);
});

test("the delete action keeps its destructive (danger) styling", () => {
  const card = cardComponentSource();
  const dangerStart = card.indexOf('variant="danger"');
  assert.notEqual(dangerStart, -1);
  const btnSlice = card.slice(dangerStart, card.indexOf("</Button>", dangerStart));
  assert.ok(btnSlice.includes("מחיקה"));
});

test("opening the menu never calls onDelete/onEdit/onManageRiding by itself - only setMenuOpen(true)", () => {
  const card = cardComponentSource();
  const openHandlerStart = card.indexOf("onClick={(e) => {");
  const openHandlerEnd = card.indexOf("}}", openHandlerStart);
  const openHandler = card.slice(openHandlerStart, openHandlerEnd);
  assert.ok(openHandler.includes("setMenuOpen(true)"));
  assert.ok(!openHandler.includes("onEdit("));
  assert.ok(!openHandler.includes("onDelete("));
  assert.ok(!openHandler.includes("onManageRiding("));
});

test("each menu action closes the menu (setMenuOpen(false)) before invoking its handler", () => {
  const card = cardComponentSource();
  const editIdx = card.indexOf("onEdit(item);");
  const ridingIdx = card.indexOf("onManageRiding(item);");
  const deleteIdx = card.indexOf("onDelete(item);");
  for (const idx of [editIdx, ridingIdx, deleteIdx]) {
    const preceding = card.slice(Math.max(0, idx - 80), idx);
    assert.ok(preceding.includes("setMenuOpen(false);"), "expected setMenuOpen(false) immediately before the handler call");
  }
});

// ---------------------------------------------------------------------------
// Merged/grouped card identifiers preserved exactly.
// ---------------------------------------------------------------------------

test("merged-card id splitting (composite '+'-joined ids) is preserved unchanged", () => {
  const card = cardComponentSource();
  assert.ok(card.includes('const sourceIds = item.id.split("+");'));
  assert.ok(card.includes("const isMerged = sourceIds.length > 1;"));
});

test("a merged card shows the existing non-deletable notice instead of a delete button, and does not expose delete via any other path", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("isMerged ? ("));
  assert.ok(card.includes("מחיקה לא זמינה עבור פעילות ממוזגת"));
  // Exactly one danger Button in the whole component, and it's the one guarded
  // by !isMerged (i.e. only reachable in the else-branch).
  const dangerCount = (card.match(/variant="danger"/g) ?? []).length;
  assert.equal(dangerCount, 1);
});

test("the item object itself is passed through to every handler untouched - no id rewriting, no argument shape change", () => {
  const card = cardComponentSource();
  assert.ok(card.includes("onEdit(item)"));
  assert.ok(card.includes("onManageRiding(item)"));
  assert.ok(card.includes("onDelete(item)"));
  assert.ok(!/onEdit\(item\.id\)|onDelete\(item\.id\)|onManageRiding\(item\.id\)/.test(card), "handlers must still receive the full item, matching openEdit/openDelete/openManageRiding signatures");
});

// ---------------------------------------------------------------------------
// Both call sites (compact grid + non-compact single-group list) use the
// same ScheduleCard/trigger - one consistent control, no silent duplication.
// ---------------------------------------------------------------------------

test("the compact (all-groups grid) call site renders ScheduleCard with compact", () => {
  assert.match(SECTION, /renderCard=\{\(item\) => \(\s*<ScheduleCard[\s\S]*?compact\s*\/>\s*\)\}/);
});

test("the non-compact (single-group list) call site renders the same ScheduleCard, without compact", () => {
  const mapStart = SECTION.indexOf(".map((item) => (");
  const mapEnd = SECTION.indexOf("))}", mapStart);
  const mapBlock = SECTION.slice(mapStart, mapEnd);
  assert.ok(mapBlock.includes("<ScheduleCard"));
  assert.ok(mapBlock.includes("key={item.id}"));
  assert.ok(!mapBlock.includes("compact"), "the non-compact list call site must not pass compact");
});

test("no old inline button cluster remains - each action appears exactly once (inside the menu), not duplicated inline per card", () => {
  const card = cardComponentSource();
  assert.equal((card.match(/>\s*עריכה\s*</g) ?? []).length, 1);
  assert.equal((card.match(/>\s*ניהול רכיבה\s*</g) ?? []).length, 1);
  assert.equal((card.match(/>\s*מחיקה\s*</g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// Parent-level state (edit modal, delete confirmation, riding modal) is
// completely untouched by this change.
// ---------------------------------------------------------------------------

test("the existing edit modal, delete-confirmation modal, and RidingSlotModal wiring are all untouched", () => {
  assert.match(SECTION, /const \[modalItem, setModalItem\] = useState<ScheduleItemView \| "new" \| null>\(null\);/);
  assert.match(SECTION, /const \[deleteTarget, setDeleteTarget\] = useState<ScheduleItemView \| null>\(null\);/);
  assert.match(SECTION, /const \[ridingTarget, setRidingTarget\] = useState<ScheduleItemView \| null>\(null\);/);
  assert.match(SECTION, /<RidingSlotModal/);
  assert.match(SECTION, /scheduleItemIds=\{ridingScheduleItemIds\}/);
});
