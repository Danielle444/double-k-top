/**
 * RIDING-COMPLEX-PUBLICATION-TIMEOUT-FIX - ENVIRONMENT-GATED integration tests
 * for the batched publish write that replaced the per-block/per-station
 * sequential create loop (P2028 audit) in publishComplexRidingPlanInternal.
 *
 * SKIPPED BY DEFAULT. They run ONLY when `RIDING_COMPLEX_PUBLICATION_DB_TEST_URL`
 * names a dedicated NON-PRODUCTION Postgres database. During the standard
 * validation sequence (variable absent) every test is skipped, this parent
 * process imports NO application/Prisma module, and no database is contacted.
 * Same isolation model as lib/trainee-history/horse-write-service.int.test.ts:
 * the shared `@/lib/prisma` singleton is memoized on `globalThis`, so the DB
 * work runs in a FRESH child process whose `DATABASE_URL` is set (from the
 * verified test URL) before Node starts.
 *
 * Production ref `yjnjfnesxhmzhzpwrmqy` is rejected (case-insensitive) before
 * any import/spawn. The URL/credentials are never printed. All fixtures are
 * synthetic; each child deletes its own WeeklySchedule (cascades through
 * ScheduleItem -> RidingSlot -> RidingSlotComplexPlan -> blocks/stations/pairs
 * AND -> publication -> its own blocks/stations/pairs) and Instructor rows in
 * a `finally`.
 *
 * COVERAGE:
 *  - T1: a plan at the actual Production failure scale (8 blocks/22 stations/
 *    39 pairs) publishes successfully through EXACTLY 6 tx-scoped DB round
 *    trips (findUnique, upsert, deleteMany, 3 batched creates) - proving the
 *    round-trip count is constant, not O(blocks + stations). Also proves every
 *    created station/pair's foreign key resolves to a parent from the SAME
 *    publication, sortOrder is preserved exactly, and every snapshot field
 *    (horseName) survives unchanged.
 *  - T2: an injected failure on the final batched write (pair createMany)
 *    rejects the publish call and leaves ZERO publication/block/station/pair
 *    rows behind - proving the interactive transaction still rolls back
 *    everything (including the upsert and earlier batches), not just the
 *    failing call.
 *  - T3: republishing after the live plan grows (adds a block/station/pair)
 *    reuses the SAME publication row (upsert) and replaces the ENTIRE child
 *    hierarchy with the new counts exactly (no leftover old rows, no
 *    duplicate-append).
 *
 * Run intentionally with (do NOT run during standard validation):
 *   RIDING_COMPLEX_PUBLICATION_DB_TEST_URL=postgres://... \
 *     npx tsx --test lib/actions/riding-slot-complex-publications.int.test.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_REF = "yjnjfnesxhmzhzpwrmqy";

const rawUrl = process.env.RIDING_COMPLEX_PUBLICATION_DB_TEST_URL;
const testUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
const enabled = testUrl.length > 0;

// Reject the production project ref BEFORE any DB import or spawn. This parent
// process never imports @/lib/prisma, so this runs before any DB client exists.
if (enabled && testUrl.toLowerCase().includes(PRODUCTION_REF)) {
  throw new Error(
    "RIDING_COMPLEX_PUBLICATION_DB_TEST_URL resolves to the production project ref; refusing to run integration tests."
  );
}

const skip = enabled ? false : "RIDING_COMPLEX_PUBLICATION_DB_TEST_URL not set (integration tests skipped)";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Same fixed bootstrap/redaction shape as the trainee-history harness: decode
// the child program from an env var and run it as an async function in a
// child that already has DATABASE_URL = test URL. Any error written to
// stderr is redacted so the URL/host/user/password never print.
const BOOTSTRAP = [
  "function __redact(s) {",
  "  s = String(s);",
  "  try {",
  '    var u = process.env.DATABASE_URL || "";',
  "    if (u) {",
  '      s = s.split(u).join("<redacted-url>");',
  "      var parsed = new URL(u);",
  "      var parts = [parsed.host, parsed.hostname, parsed.username, parsed.password];",
  "      for (var i = 0; i < parts.length; i++) {",
  '        if (parts[i]) s = s.split(parts[i]).join("<redacted>");',
  "      }",
  "    }",
  "  } catch (ignore) {}",
  '  return s.replace(/(postgres(?:ql)?:\\/\\/)[^\\s"\\x27]+/gi, "$1<redacted>");',
  "}",
  'var src = process.env.__RCP_CHILD_SRC || "";',
  "var AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;",
  "AsyncFunction(src)()",
  "  .then(function () { process.exit(0); })",
  '  .catch(function (e) { process.stderr.write(__redact(e && e.stack ? e.stack : e) + "\\n"); process.exit(1); });',
].join("\n");

/**
 * Child program (plain JS; NOT type-checked here, matching the trainee-history
 * harness convention). Seeds a large complex-riding plan tree directly against
 * the live tables (bypassing UI/action save-time validation, which is
 * legitimate for a DB fixture), publishes it via the real, unexported-internal
 * -delegating instructor action (no NextAuth session needed - the instructor
 * path is DB-re-read only), and asserts the batched-write contract.
 */
const CHILD_SRC = String.raw`
const pubMod = await import("@/lib/actions/riding-slot-complex-publications");
const publishAsInstructor = pubMod.publishComplexRidingPlanAsInstructor;
const prismaMod = await import("@/lib/prisma");
const prisma = prismaMod.prisma || (prismaMod.default && prismaMod.default.prisma);
const cryptoMod = await import("node:crypto");
const randomUUID = cryptoMod.randomUUID || (cryptoMod.default && cryptoMod.default.randomUUID);

function assertTrue(cond, msg) { if (!cond) throw new Error("ASSERT FAILED: " + msg); }
function d(key) { return new Date(key + "T00:00:00.000Z"); }

// Mirrors the actual Production failure scale confirmed by the P2028 audit:
// 8 blocks, 22 stations total, 39 pairs total.
const STATIONS_PER_BLOCK = [3, 3, 3, 3, 3, 3, 2, 2];
const PAIRS_PER_STATION = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1];
assertTrue(STATIONS_PER_BLOCK.reduce((a, b) => a + b, 0) === 22, "fixture station total sanity");
assertTrue(PAIRS_PER_STATION.reduce((a, b) => a + b, 0) === 39, "fixture pair total sanity");
assertTrue(PAIRS_PER_STATION.length === 22, "fixture pair distribution has one entry per station");

// --- synthetic fixtures (tracked for FK-safe cleanup) -----------------------
const createdWeeks = [];
const createdInstructors = [];

async function makeInstructor() {
  const suffix = randomUUID();
  const instructor = await prisma.instructor.create({
    data: { firstName: "RCP", lastName: suffix, fullName: "RCP " + suffix, identityNumber: "RCP-" + suffix, isActive: true, canEditRidingNotes: true },
    select: { id: true },
  });
  createdInstructors.push(instructor.id);
  return instructor.id;
}

async function makeRidingSlot() {
  const suffix = randomUUID();
  const week = await prisma.weeklySchedule.create({
    data: { name: "RCP-week-" + suffix, startDate: d("2026-01-05"), endDate: d("2026-01-11"), uploadedFileName: "rcp-test.xlsx" },
    select: { id: true },
  });
  createdWeeks.push(week.id);
  const item = await prisma.scheduleItem.create({
    data: { weeklyScheduleId: week.id, date: d("2026-01-05"), startTime: "09:00", endTime: "12:00", title: "RCP test session" },
    select: { id: true },
  });
  const slot = await prisma.ridingSlot.create({ data: { scheduleItemId: item.id }, select: { id: true } });
  return slot.id;
}

async function makePlan(ridingSlotId) {
  const plan = await prisma.ridingSlotComplexPlan.create({
    data: { ridingSlotId: ridingSlotId, updatedByName: "RCP test" },
    select: { id: true },
  });
  return plan.id;
}

async function seedLargePlanTree(planId) {
  let stationSeq = 0;
  let pairSeq = 0;
  for (let bIdx = 0; bIdx < STATIONS_PER_BLOCK.length; bIdx++) {
    const block = await prisma.ridingSlotComplexBlock.create({
      data: { planId: planId, startTime: "09:00", endTime: "09:45", sortOrder: bIdx },
      select: { id: true },
    });
    for (let k = 0; k < STATIONS_PER_BLOCK[bIdx]; k++) {
      const station = await prisma.ridingSlotComplexStation.create({
        data: { blockId: block.id, sortOrder: k, arena: "Arena-" + stationSeq },
        select: { id: true },
      });
      const pairCount = PAIRS_PER_STATION[stationSeq];
      stationSeq += 1;
      for (let p = 0; p < pairCount; p++) {
        await prisma.ridingSlotComplexPair.create({
          data: { stationId: station.id, sortOrder: p, horseName: "Horse-" + pairSeq },
        });
        pairSeq += 1;
      }
    }
  }
}

async function cleanupAll() {
  if (createdWeeks.length > 0) {
    await prisma.weeklySchedule.deleteMany({ where: { id: { in: createdWeeks } } });
  }
  if (createdInstructors.length > 0) {
    await prisma.instructor.deleteMany({ where: { id: { in: createdInstructors } } });
  }
}

// Wraps prisma.$transaction so every method call made through the interactive
// transaction's tx client is tallied as "Model.method" - proves the ACTUAL
// number of DB round trips a publish call makes, not just what the source
// appears to do. Same singleton instance the engine imports, so the
// interactive-transaction client it receives is the proxied one.
function installTxCallCounter() {
  const orig = prisma.$transaction.bind(prisma);
  let calls = [];
  prisma.$transaction = function (arg, opts) {
    if (typeof arg !== "function") { return orig(arg, opts); }
    calls = [];
    return orig(function (tx) {
      const proxied = new Proxy(tx, {
        get: function (target, prop) {
          const delegate = target[prop];
          if (delegate && typeof delegate === "object") {
            return new Proxy(delegate, {
              get: function (dTarget, dProp) {
                const dv = dTarget[dProp];
                if (typeof dv === "function") {
                  return function (...args) {
                    calls.push(String(prop) + "." + String(dProp));
                    return dv.apply(dTarget, args);
                  };
                }
                return dv;
              },
            });
          }
          return typeof delegate === "function" ? delegate.bind(target) : delegate;
        },
      });
      return arg(proxied);
    }, opts);
  };
  return {
    restore: function () { prisma.$transaction = orig; },
    getCalls: function () { return calls; },
  };
}

// Temporarily makes ONE specific tx delegate method throw, to prove the whole
// interactive transaction rolls back (upsert + earlier batches included), not
// just the failing call. Restores the original on teardown.
function installBatchFailure(delegateName, methodName) {
  const orig = prisma.$transaction.bind(prisma);
  prisma.$transaction = function (arg, opts) {
    if (typeof arg !== "function") { return orig(arg, opts); }
    return orig(function (tx) {
      const proxied = new Proxy(tx, {
        get: function (target, prop) {
          if (prop === delegateName) {
            const delegate = target[prop];
            return new Proxy(delegate, {
              get: function (dTarget, dProp) {
                if (dProp === methodName) {
                  return async function () { throw new Error("INJECTED_" + delegateName + "_" + methodName + "_FAIL"); };
                }
                const dv = dTarget[dProp];
                return typeof dv === "function" ? dv.bind(dTarget) : dv;
              },
            });
          }
          const v = target[prop];
          return typeof v === "function" ? v.bind(target) : v;
        },
      });
      return arg(proxied);
    }, opts);
  };
  return function restore() { prisma.$transaction = orig; };
}

try {
  // ---- T1: large-plan (8/22/39) publish - constant round trips + exact hierarchy correlation.
  {
    const instructorId = await makeInstructor();
    const ridingSlotId = await makeRidingSlot();
    const planId = await makePlan(ridingSlotId);
    await seedLargePlanTree(planId);

    const counter = installTxCallCounter();
    let res;
    try {
      res = await publishAsInstructor(instructorId, ridingSlotId);
    } finally {
      counter.restore();
    }
    assertTrue(res.success === true, "T1 large-plan publish succeeded: " + JSON.stringify(res));

    const calls = counter.getCalls();
    assertTrue(calls.length === 6, "T1 exactly 6 tx-scoped DB round trips regardless of plan scale, got " + calls.length + ": " + JSON.stringify(calls));
    assertTrue(calls.filter((c) => c.endsWith(".create")).length === 0, "T1 no per-row .create call survives for block/station/pair: " + JSON.stringify(calls));
    assertTrue(calls.filter((c) => c.endsWith(".createManyAndReturn")).length === 2, "T1 exactly 2 createManyAndReturn calls (blocks, stations)");
    assertTrue(calls.filter((c) => c === "ridingSlotComplexPublicationPair.createMany").length === 1, "T1 exactly 1 pair createMany call");

    const pub = await prisma.ridingSlotComplexPublication.findUniqueOrThrow({ where: { planId: planId }, select: { id: true } });
    const blocks = await prisma.ridingSlotComplexPublicationBlock.findMany({ where: { publicationId: pub.id }, select: { id: true, sortOrder: true } });
    assertTrue(blocks.length === 8, "T1 8 publication blocks created, got " + blocks.length);
    const blockIds = new Set(blocks.map((b) => b.id));
    const blockSortOrders = blocks.map((b) => b.sortOrder).slice().sort((a, b) => a - b);
    assertTrue(JSON.stringify(blockSortOrders) === JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7]), "T1 block sortOrder preserved exactly 0..7");

    const stations = await prisma.ridingSlotComplexPublicationStation.findMany({ where: { publicationBlockId: { in: [...blockIds] } }, select: { id: true, publicationBlockId: true } });
    assertTrue(stations.length === 22, "T1 22 publication stations created, got " + stations.length);
    assertTrue(stations.every((s) => blockIds.has(s.publicationBlockId)), "T1 every station's FK resolves to a block from THIS publication");

    const stationIds = new Set(stations.map((s) => s.id));
    const pairs = await prisma.ridingSlotComplexPublicationPair.findMany({ where: { publicationStationId: { in: [...stationIds] } }, select: { id: true, publicationStationId: true, horseName: true } });
    assertTrue(pairs.length === 39, "T1 39 publication pairs created, got " + pairs.length);
    assertTrue(pairs.every((p) => stationIds.has(p.publicationStationId)), "T1 every pair's FK resolves to a station from THIS publication");

    const expectedHorseNames = new Set(Array.from({ length: 39 }, (_, i) => "Horse-" + i));
    const actualHorseNames = new Set(pairs.map((p) => p.horseName));
    assertTrue(actualHorseNames.size === 39, "T1 no duplicate/collapsed horseName snapshot");
    assertTrue([...expectedHorseNames].every((h) => actualHorseNames.has(h)), "T1 every seeded horseName snapshot preserved exactly");
  }

  // ---- T2: injected failure on the FINAL batched write rolls back EVERYTHING.
  {
    const instructorId = await makeInstructor();
    const ridingSlotId = await makeRidingSlot();
    const planId = await makePlan(ridingSlotId);
    await seedLargePlanTree(planId);

    const restore = installBatchFailure("ridingSlotComplexPublicationPair", "createMany");
    let threw = false;
    try {
      await publishAsInstructor(instructorId, ridingSlotId);
    } catch (e) {
      threw = true;
    } finally {
      restore();
    }
    assertTrue(threw, "T2 injected pair-createMany failure must reject, not be swallowed");

    const pubCount = await prisma.ridingSlotComplexPublication.count({ where: { planId: planId } });
    assertTrue(pubCount === 0, "T2 no publication row survives - the upsert itself rolled back too");
    const blockCount = await prisma.ridingSlotComplexPublicationBlock.count({ where: { publication: { planId: planId } } });
    assertTrue(blockCount === 0, "T2 no publication blocks survive a failure mid-batch");
    const stationCount = await prisma.ridingSlotComplexPublicationStation.count({ where: { publicationBlock: { publication: { planId: planId } } } });
    assertTrue(stationCount === 0, "T2 no publication stations survive a failure mid-batch");
  }

  // ---- T3: republish after the live plan GROWS replaces the whole hierarchy exactly.
  {
    const instructorId = await makeInstructor();
    const ridingSlotId = await makeRidingSlot();
    const planId = await makePlan(ridingSlotId);
    await seedLargePlanTree(planId);

    const res1 = await publishAsInstructor(instructorId, ridingSlotId);
    assertTrue(res1.success === true, "T3 first publish ok");

    const pub1 = await prisma.ridingSlotComplexPublication.findUniqueOrThrow({ where: { planId: planId }, select: { id: true } });
    const blockCount1 = await prisma.ridingSlotComplexPublicationBlock.count({ where: { publicationId: pub1.id } });
    assertTrue(blockCount1 === 8, "T3 first publish has 8 blocks");

    // Grow the live plan by one block/station/pair, bump plan.version (mirrors
    // what saveComplexStationInternal does on every live edit).
    const extraBlock = await prisma.ridingSlotComplexBlock.create({ data: { planId: planId, startTime: "10:00", endTime: "10:30", sortOrder: 8 }, select: { id: true } });
    const extraStation = await prisma.ridingSlotComplexStation.create({ data: { blockId: extraBlock.id, sortOrder: 0 }, select: { id: true } });
    await prisma.ridingSlotComplexPair.create({ data: { stationId: extraStation.id, sortOrder: 0, horseName: "Extra" } });
    await prisma.ridingSlotComplexPlan.update({ where: { id: planId }, data: { version: { increment: 1 } } });

    const res2 = await publishAsInstructor(instructorId, ridingSlotId);
    assertTrue(res2.success === true, "T3 republish ok");

    const pub2 = await prisma.ridingSlotComplexPublication.findUniqueOrThrow({ where: { planId: planId }, select: { id: true } });
    assertTrue(pub2.id === pub1.id, "T3 republish reuses the SAME publication row (upsert, not a second row)");

    const blockCount2 = await prisma.ridingSlotComplexPublicationBlock.count({ where: { publicationId: pub2.id } });
    const stationCount2 = await prisma.ridingSlotComplexPublicationStation.count({ where: { publicationBlock: { publicationId: pub2.id } } });
    const pairCount2 = await prisma.ridingSlotComplexPublicationPair.count({ where: { publicationStation: { publicationBlock: { publicationId: pub2.id } } } });
    assertTrue(blockCount2 === 9, "T3 republish has exactly 9 blocks (8 + 1 new), got " + blockCount2);
    assertTrue(stationCount2 === 23, "T3 republish has exactly 23 stations (22 + 1 new), got " + stationCount2);
    assertTrue(pairCount2 === 40, "T3 republish has exactly 40 pairs (39 + 1 new), got " + pairCount2);
  }

  process.stdout.write("CHILD_RESULT_OK\n");
} finally {
  await cleanupAll();
  await prisma.$disconnect();
}
`;

// Defense-in-depth: strip the test URL and its host/user/password from any
// text surfaced in assertion messages.
function redact(text: string): string {
  let out = text;
  try {
    if (testUrl) {
      out = out.split(testUrl).join("<redacted-url>");
      const u = new URL(testUrl);
      for (const part of [u.host, u.hostname, u.username, u.password]) {
        if (part) out = out.split(part).join("<redacted>");
      }
    }
  } catch {
    /* ignore URL parse issues */
  }
  return out.replace(/(postgres(?:ql)?:\/\/)[^\s"']+/gi, "$1<redacted>");
}

function runChildLifecycle(): ReturnType<typeof spawnSync> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl, __RCP_CHILD_SRC: CHILD_SRC };
  delete childEnv.RIDING_COMPLEX_PUBLICATION_DB_TEST_URL;
  return spawnSync(process.execPath, ["--import", "tsx", "-e", BOOTSTRAP], {
    cwd: repoRoot,
    env: childEnv,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
}

function childTimedOut(result: ReturnType<typeof spawnSync>): boolean {
  const err = result.error as NodeJS.ErrnoException | undefined;
  if (err && err.code === "ETIMEDOUT") return true;
  return result.signal === "SIGTERM";
}

test("integration/riding-complex-publication: large-plan batched publish, atomic rollback, and republish-replace", { skip }, () => {
  const result = runChildLifecycle();
  assert.ok(!childTimedOut(result), "integration child timed out");
  assert.equal(result.error, undefined, "child process failed to spawn");
  assert.equal(
    result.status,
    0,
    `child exited ${String(result.status)}; stderr:\n${redact(String(result.stderr ?? ""))}`
  );
  assert.ok(
    typeof result.stdout === "string" && result.stdout.includes("CHILD_RESULT_OK"),
    `child did not report success; stdout:\n${redact(String(result.stdout ?? ""))}`
  );
});
