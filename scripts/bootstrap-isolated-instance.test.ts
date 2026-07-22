/**
 * MC-BOOTSTRAP-S2A — executable tests for the PURE orchestration + CLI/config
 * boundary (bootstrap-isolated-instance.ts).
 *
 * Run with: npx tsx --test scripts/bootstrap-isolated-instance.test.ts
 *
 * DATABASE-FREE: no Prisma, no DB, no Supabase, no Storage, no env, no network,
 * no clock. Every effect is a SYNTHETIC injected fake. All fixtures are synthetic
 * (no real course names, people, keys, dates, or project refs); the only
 * production-like literal is the deny-only production ref, used solely to assert
 * that a production target is rejected and never printed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXIT,
  parseCliArgs,
  parseConfigDocument,
  runBootstrapOrchestration,
  type OrchestrationDeps,
  type DetectedTarget,
  type ApplyTransaction,
  type BootstrapWriteInput,
} from "./bootstrap-isolated-instance";
import {
  buildBootstrapPlan,
  parseBootstrapConfig,
  classifyAggregateBootstrapState,
  type ObservedStructuralState,
  type BootstrapCreationPlan,
} from "./bootstrap-isolated-instance.plan";

// --- synthetic fixtures ------------------------------------------------------

const REF_A = "aaaa1111bbbb2222cccc";
const REF_B = "zzzz9999yyyy8888xxxx";
const PROD_REF = "yjnjfnesxhmzhzpwrmqy"; // deny-only

function validConfigObject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    activityYear: { name: "YEAR-SYNTH" },
    offering: {
      name: "OFFERING-SYNTH",
      level: 1,
      startDate: "2000-01-01",
      endDate: "2000-02-01",
      status: "PLANNED",
    },
    groups: [{ name: "TOP-1", subgroups: [{ name: "1" }] }],
    capabilities: [{ key: "CAP_A", label: "LABEL_A", isActive: true, offeringStatus: "ENABLED" }],
    ...over,
  };
}

const TWO_CAP_CONFIG = validConfigObject({
  capabilities: [
    { key: "CAP_A", label: "LABEL_A", isActive: true, offeringStatus: "ENABLED" },
    { key: "CAP_B", label: "LABEL_B", isActive: true, offeringStatus: "READ_ONLY" },
  ],
});

function planFromObject(obj: Record<string, unknown>): BootstrapCreationPlan {
  const parsed = parseBootstrapConfig(obj);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("unreachable");
  return buildBootstrapPlan(parsed.config);
}

const PLAN = planFromObject(validConfigObject());
const PLAN2 = planFromObject(TWO_CAP_CONFIG);

const EMPTY_OBSERVED: ObservedStructuralState = {
  activityYears: [],
  courseOfferings: [],
  courseGroups: [],
  capabilityCatalog: [],
  offeringCapabilities: [],
};

function mkObserved(partial: Partial<ObservedStructuralState>): ObservedStructuralState {
  return { ...EMPTY_OBSERVED, ...partial };
}

function exactObservedFor(plan: BootstrapCreationPlan): ObservedStructuralState {
  const nameByRef = new Map(plan.courseGroups.map((g) => [g.ref, g.name] as const));
  return {
    activityYears: [
      { name: plan.activityYear.name, startDate: plan.activityYear.startDate, endDate: plan.activityYear.endDate },
    ],
    courseOfferings: [
      {
        name: plan.courseOffering.name,
        level: plan.courseOffering.level,
        startDate: plan.courseOffering.startDate,
        endDate: plan.courseOffering.endDate,
        status: plan.courseOffering.status,
        activityYearName: plan.activityYear.name,
      },
    ],
    courseGroups: plan.courseGroups.map((g) => ({
      name: g.name,
      parentName: g.parentGroupRef === null ? null : (nameByRef.get(g.parentGroupRef) ?? null),
    })),
    capabilityCatalog: plan.capabilityCatalog.map((c) => ({ key: c.key, label: c.label, isActive: c.isActive })),
    offeringCapabilities: plan.offeringCapabilities.map((o) => ({ key: o.capabilityKey, status: o.status })),
  };
}

// --- synthetic dependency harness --------------------------------------------

interface Spy {
  logs: string[];
  events: string[];
  detectCalls: number;
  readCalls: number;
  txCalls: number;
  writeInputs: BootstrapWriteInput[];
  cleanupCalls: number;
}

interface DepsOptions {
  config?: string | (() => string);
  detected?: DetectedTarget | (() => DetectedTarget);
  observed?: ObservedStructuralState;
  fresh?: ObservedStructuralState;
  writeThrows?: boolean;
  txThrows?: boolean;
  cleanupThrows?: boolean;
}

function makeDeps(opts: DepsOptions = {}): { deps: OrchestrationDeps; spy: Spy } {
  const spy: Spy = {
    logs: [],
    events: [],
    detectCalls: 0,
    readCalls: 0,
    txCalls: 0,
    writeInputs: [],
    cleanupCalls: 0,
  };
  const configText = opts.config ?? JSON.stringify(validConfigObject());
  const deps: OrchestrationDeps = {
    readConfigFile: () => (typeof configText === "function" ? configText() : configText),
    detectTarget: () => {
      spy.detectCalls++;
      if (typeof opts.detected === "function") return opts.detected();
      return opts.detected ?? { detectedProjectRef: REF_A };
    },
    readStructuralState: async () => {
      spy.readCalls++;
      return opts.observed ?? EMPTY_OBSERVED;
    },
    withTransaction: async (work) => {
      spy.txCalls++;
      if (opts.txThrows) throw new Error("tx open failed");
      const tx: ApplyTransaction = {
        readFresh: async () => {
          spy.events.push("readFresh");
          return opts.fresh ?? opts.observed ?? EMPTY_OBSERVED;
        },
        writeBootstrap: async (input) => {
          spy.events.push("write");
          if (opts.writeThrows) throw new Error("write failed");
          spy.writeInputs.push(input);
        },
      };
      return work(tx);
    },
    cleanup: async () => {
      spy.cleanupCalls++;
      if (opts.cleanupThrows) throw new Error("cleanup failed");
    },
    log: (line) => spy.logs.push(line),
  };
  return { deps, spy };
}

const argvDry = (ref = REF_A): string[] => ["--config", "cfg.json", "--expected-target-ref", ref];
const argvApply = (ref = REF_A): string[] => ["--config", "cfg.json", "--expected-target-ref", ref, "--apply"];

async function run(argv: readonly string[], opts: DepsOptions = {}): Promise<{ code: number; spy: Spy }> {
  const { deps, spy } = makeDeps(opts);
  const code = await runBootstrapOrchestration(argv, deps);
  return { code, spy };
}

const SENSITIVE = [
  "YEAR-SYNTH",
  "OFFERING-SYNTH",
  "LABEL_A",
  "LABEL_B",
  "CAP_A",
  "CAP_B",
  "TOP-1",
  "2000-01-01",
  "2000-02-01",
  REF_A,
  REF_B,
  PROD_REF,
  "cfg.json",
];

function assertNoSensitive(logs: readonly string[]): void {
  const joined = logs.join("\n");
  for (const s of SENSITIVE) {
    assert.equal(joined.includes(s), false, `output must not contain "${s}"`);
  }
}

// ===========================================================================
// CLI parsing (1–8, both forms)
// ===========================================================================

test("1. dry-run is the default (no --apply)", async () => {
  const cli = parseCliArgs(argvDry());
  assert.equal(cli.ok, true);
  if (cli.ok) assert.equal(cli.apply, false);

  const { code, spy } = await run(argvDry(), { observed: EMPTY_OBSERVED });
  assert.equal(code, EXIT.OK);
  assert.equal(spy.txCalls, 0);
  assert.ok(spy.logs.includes("mode=DRY_RUN"));
});

test("2. --apply is explicit and must be unique", () => {
  const ok = parseCliArgs(argvApply());
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.apply, true);

  const dup = parseCliArgs(["--config", "a", "--expected-target-ref", REF_A, "--apply", "--apply"]);
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.ok(dup.errors.some((e) => e.includes("duplicate flag --apply")));
});

test("3. --config is required", () => {
  const r = parseCliArgs(["--expected-target-ref", REF_A]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("missing required flag --config")));
});

test("4. --expected-target-ref is required", () => {
  const r = parseCliArgs(["--config", "a"]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("missing required flag --expected-target-ref")));
});

test("5. missing flag values are rejected", () => {
  assert.equal(parseCliArgs(["--config"]).ok, false);
  // a following flag is NOT a value
  const r = parseCliArgs(["--config", "--expected-target-ref", REF_A]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("missing value for --config")));
  // empty inline value rejected
  const empty = parseCliArgs(["--config=", "--expected-target-ref", REF_A]);
  assert.equal(empty.ok, false);
});

test("6. duplicate flags are rejected", () => {
  const r = parseCliArgs(["--config", "a", "--config", "b", "--expected-target-ref", REF_A]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("duplicate flag --config")));
});

test("7. unknown flags are rejected", () => {
  const r = parseCliArgs(["--config", "a", "--expected-target-ref", REF_A, "--bogus"]);
  assert.equal(r.ok, false);
  if (!r.ok) assert.ok(r.errors.some((e) => e.includes("unknown flag --bogus")));
});

test("8. positional arguments are rejected; both flag forms accepted", () => {
  const pos = parseCliArgs(["--config", "a", "--expected-target-ref", REF_A, "stray"]);
  assert.equal(pos.ok, false);
  if (!pos.ok) assert.ok(pos.errors.some((e) => e.includes("unexpected positional argument")));

  const eqForm = parseCliArgs([`--config=a`, `--expected-target-ref=${REF_A}`, "--apply"]);
  assert.equal(eqForm.ok, true);
  if (eqForm.ok) {
    assert.equal(eqForm.configPath, "a");
    assert.equal(eqForm.expectedTargetRef, REF_A);
    assert.equal(eqForm.apply, true);
  }

  // orchestration: a CLI error stops with EXIT.INPUT, before detect/read, cleanup still runs
  return run(["--bogus"]).then(({ code, spy }) => {
    assert.equal(code, EXIT.INPUT);
    assert.equal(spy.detectCalls, 0);
    assert.equal(spy.readCalls, 0);
    assert.equal(spy.cleanupCalls, 1);
  });
});

// ===========================================================================
// Config-document boundary (9–13)
// ===========================================================================

test("9. invalid JSON stops before target detection or structural read", async () => {
  const { code, spy } = await run(argvDry(), { config: "{ not valid json" });
  assert.equal(code, EXIT.INPUT);
  assert.equal(spy.detectCalls, 0);
  assert.equal(spy.readCalls, 0);
  assert.ok(spy.logs.includes("stage=shape"));
});

test("10. a non-object JSON root stops", async () => {
  for (const root of ["[]", "123", '"a string"', "null"]) {
    const doc = parseConfigDocument(root);
    assert.equal(doc.ok, false);
    const { code, spy } = await run(argvDry(), { config: root });
    assert.equal(code, EXIT.INPUT);
    assert.equal(spy.detectCalls, 0);
  }
});

test("11. an unknown top-level config key stops", async () => {
  const text = JSON.stringify(validConfigObject({ extra: 1 }));
  assert.equal(parseConfigDocument(text).ok, false);
  const { code, spy } = await run(argvDry(), { config: text });
  assert.equal(code, EXIT.INPUT);
  assert.equal(spy.detectCalls, 0);
});

test("12. an unknown nested config key stops", async () => {
  const text = JSON.stringify(
    validConfigObject({ offering: { name: "O", level: 1, startDate: "2000-01-01", endDate: "2000-02-01", status: "PLANNED", ghost: true } }),
  );
  assert.equal(parseConfigDocument(text).ok, false);
  const { code, spy } = await run(argvDry(), { config: text });
  assert.equal(code, EXIT.INPUT);
  assert.equal(spy.detectCalls, 0);

  // nested inside groups/subgroups/capabilities too
  const nested = JSON.stringify(validConfigObject({ groups: [{ name: "TOP-1", subgroups: [{ name: "1", weird: 1 }] }] }));
  assert.equal(parseConfigDocument(nested).ok, false);
});

test("13. S1 domain-validation failure stops before target detection/read", async () => {
  // valid shape (no unknown keys), but offering.status is missing -> S1 rejects
  const text = JSON.stringify({
    activityYear: { name: "YEAR-SYNTH" },
    offering: { name: "OFFERING-SYNTH", level: 1, startDate: "2000-01-01", endDate: "2000-02-01" },
    groups: [{ name: "TOP-1" }],
    capabilities: [],
  });
  assert.equal(parseConfigDocument(text).ok, true); // shape ok
  const { code, spy } = await run(argvDry(), { config: text });
  assert.equal(code, EXIT.INPUT);
  assert.ok(spy.logs.includes("stage=config"));
  assert.equal(spy.detectCalls, 0);
  assert.equal(spy.readCalls, 0);
});

// ===========================================================================
// Target-safety boundary (14–17)
// ===========================================================================

test("14. unavailable/malformed detected identity stops before structural read", async () => {
  const nullRef = await run(argvDry(), { detected: { detectedProjectRef: null } });
  assert.equal(nullRef.code, EXIT.STOP);
  assert.equal(nullRef.spy.readCalls, 0);
  assert.ok(nullRef.spy.logs.includes("result=TARGET_REJECTED"));

  const thrown = await run(argvDry(), { detected: () => { throw new Error("no metadata"); } });
  assert.equal(thrown.code, EXIT.STOP);
  assert.equal(thrown.spy.readCalls, 0);
});

test("15. a production target stops before structural read (dry-run and apply)", async () => {
  const dry = await run(argvDry(PROD_REF), { detected: { detectedProjectRef: REF_A } });
  assert.equal(dry.code, EXIT.STOP);
  assert.equal(dry.spy.readCalls, 0);
  assert.ok(dry.spy.logs.includes("targetKind=production_ref_rejected"));

  const apply = await run(argvApply(PROD_REF), { detected: { detectedProjectRef: REF_A } });
  assert.equal(apply.code, EXIT.STOP);
  assert.equal(apply.spy.readCalls, 0);
  assert.equal(apply.spy.txCalls, 0);

  // production on the DETECTED side too
  const detectedProd = await run(argvDry(REF_A), { detected: { detectedProjectRef: PROD_REF } });
  assert.equal(detectedProd.code, EXIT.STOP);
  assert.equal(detectedProd.spy.readCalls, 0);
});

test("16. expected/detected mismatch stops before structural read", async () => {
  const { code, spy } = await run(argvDry(REF_A), { detected: { detectedProjectRef: REF_B } });
  assert.equal(code, EXIT.STOP);
  assert.equal(spy.readCalls, 0);
  assert.ok(spy.logs.includes("targetKind=ref_mismatch"));
});

test("17. target refs never appear in output", async () => {
  const mismatch = await run(argvDry(REF_A), { detected: { detectedProjectRef: REF_B } });
  assertNoSensitive(mismatch.spy.logs);
  const prod = await run(argvDry(PROD_REF));
  assertNoSensitive(prod.spy.logs);
  const ok = await run(argvDry(), { observed: EMPTY_OBSERVED });
  assertNoSensitive(ok.spy.logs);
});

// ===========================================================================
// Decision branching (18–21)
// ===========================================================================

test("18. INITIAL_APPLY_ALLOWED dry-run never calls the transaction", async () => {
  const { code, spy } = await run(argvDry(), { observed: EMPTY_OBSERVED });
  assert.equal(code, EXIT.OK);
  assert.equal(spy.txCalls, 0);
  assert.ok(spy.logs.includes("result=INITIAL_APPLY_PLANNED"));
  assert.ok(spy.logs.includes("decision=INITIAL_APPLY_ALLOWED"));
});

test("19. INITIAL_APPLY_ALLOWED + --apply calls the injected transaction orchestration", async () => {
  const { code, spy } = await run(argvApply(), { observed: EMPTY_OBSERVED });
  assert.equal(code, EXIT.OK);
  assert.equal(spy.txCalls, 1);
  assert.equal(spy.writeInputs.length, 1);
  assert.ok(spy.logs.includes("result=APPLY_ORCHESTRATED"));
});

test("20. EXACT_RERUN_NOOP never calls the transaction, even with --apply", async () => {
  const exact = exactObservedFor(PLAN);
  const { code, spy } = await run(argvApply(), { observed: exact });
  assert.equal(code, EXIT.OK);
  assert.equal(spy.txCalls, 0);
  assert.equal(spy.writeInputs.length, 0);
  assert.ok(spy.logs.includes("decision=EXACT_RERUN_NOOP"));
});

test("21. every STOP_CONFLICT reason never calls the transaction", async () => {
  // ENTITY_CONFLICT: two ActivityYears
  const entity = await run(argvApply(), {
    observed: mkObserved({
      activityYears: [
        { name: "YEAR-SYNTH", startDate: null, endDate: null },
        { name: "YEAR-TWO", startDate: null, endDate: null },
      ],
    }),
  });
  assert.equal(entity.code, EXIT.STOP);
  assert.equal(entity.spy.txCalls, 0);
  assert.ok(entity.spy.logs.includes("stopReason=ENTITY_CONFLICT"));

  // MIXED_ABSENT_AND_REUSE: only the ActivityYear exactly present
  const mixed = await run(argvApply(), {
    observed: mkObserved({ activityYears: [{ name: "YEAR-SYNTH", startDate: null, endDate: null }] }),
  });
  assert.equal(mixed.code, EXIT.STOP);
  assert.equal(mixed.spy.txCalls, 0);
  assert.ok(mixed.spy.logs.includes("stopReason=MIXED_ABSENT_AND_REUSE"));

  // CATALOG_INCOMPLETE_ON_RERUN: exact spine but requested catalog missing
  const exact = exactObservedFor(PLAN);
  const incomplete = await run(argvApply(), { observed: { ...exact, capabilityCatalog: [] } });
  assert.equal(incomplete.code, EXIT.STOP);
  assert.equal(incomplete.spy.txCalls, 0);
  assert.ok(incomplete.spy.logs.includes("stopReason=CATALOG_INCOMPLETE_ON_RERUN"));
});

// ===========================================================================
// No runner-side filtering (22–25)
// ===========================================================================

test("22+23. the complete observed state (incl. unrelated catalog rows) reaches S1 unchanged", async () => {
  const withUnrelated = mkObserved({
    capabilityCatalog: [
      { key: "CAP_A", label: "LABEL_A", isActive: true }, // requested, exact
      { key: "UNRELATED_GLOBAL", label: "u", isActive: true }, // global, ignored by S1
    ],
  });
  const direct = classifyAggregateBootstrapState(PLAN, withUnrelated);
  assert.equal(direct.kind, "INITIAL_APPLY_ALLOWED");

  const { code, spy } = await run(argvDry(), { observed: withUnrelated });
  assert.equal(code, EXIT.OK);
  assert.ok(spy.logs.includes("result=INITIAL_APPLY_PLANNED"));
  // requested key is reusable; the unrelated global row does not become missing/reusable
  assert.ok(spy.logs.includes("catalog.reusable=1"));
  assert.ok(spy.logs.includes("catalog.missing=0"));

  // removing the unrelated row does not change the decision -> proves it was ignored, not filtered out
  const withoutUnrelated = mkObserved({ capabilityCatalog: [{ key: "CAP_A", label: "LABEL_A", isActive: true }] });
  assert.deepEqual(
    classifyAggregateBootstrapState(PLAN, withUnrelated),
    classifyAggregateBootstrapState(PLAN, withoutUnrelated),
  );
});

test("24. multiple ActivityYears and multiple CourseOfferings both reach S1 (not deduped/filtered)", async () => {
  const twoYears = await run(argvDry(), {
    observed: mkObserved({
      activityYears: [
        { name: "YEAR-SYNTH", startDate: null, endDate: null },
        { name: "YEAR-TWO", startDate: null, endDate: null },
      ],
    }),
  });
  assert.equal(twoYears.code, EXIT.STOP);
  assert.ok(twoYears.spy.logs.includes("stopReason=ENTITY_CONFLICT"));

  const offering = {
    name: "OFFERING-SYNTH",
    level: 1,
    startDate: "2000-01-01",
    endDate: "2000-02-01",
    status: "PLANNED" as const,
    activityYearName: "YEAR-SYNTH",
  };
  const twoOfferings = await run(argvDry(), {
    observed: mkObserved({ courseOfferings: [offering, { ...offering, name: "SECOND" }] }),
  });
  assert.equal(twoOfferings.code, EXIT.STOP);
  assert.ok(twoOfferings.spy.logs.includes("stopReason=ENTITY_CONFLICT"));
});

test("25. preflight missing/reusable catalog disposition is reported only through counts", async () => {
  // requested CAP_A already synced exactly, spine absent -> INITIAL, reusable=1 missing=0
  const observed = mkObserved({ capabilityCatalog: [{ key: "CAP_A", label: "LABEL_A", isActive: true }] });
  const { spy } = await run(argvDry(), { observed });
  assert.ok(spy.logs.includes("catalog.reusable=1"));
  assert.ok(spy.logs.includes("catalog.missing=0"));
  // never the capability key/label itself
  assertNoSensitive(spy.logs);
});

// ===========================================================================
// Transaction orchestration modeling (26–31)
// ===========================================================================

test("26. the transaction re-reads and reclassifies before any write", async () => {
  const { spy } = await run(argvApply(), { observed: EMPTY_OBSERVED, fresh: EMPTY_OBSERVED });
  assert.deepEqual(spy.events, ["readFresh", "write"]);
});

test("27. state change between preflight and transaction prevents the fake write", async () => {
  // preflight EMPTY -> INITIAL; fresh = exact -> EXACT_RERUN_NOOP (no longer INITIAL) -> abort
  const { code, spy } = await run(argvApply(), { observed: EMPTY_OBSERVED, fresh: exactObservedFor(PLAN) });
  assert.equal(code, EXIT.STOP);
  assert.equal(spy.txCalls, 1);
  assert.equal(spy.writeInputs.length, 0);
  assert.deepEqual(spy.events, ["readFresh"]);
  assert.ok(spy.logs.includes("result=CONCURRENT_MODIFICATION"));
  assert.ok(spy.logs.includes("transaction.freshDecision=EXACT_RERUN_NOOP"));
});

test("28. the transaction uses the FRESH in-transaction catalog disposition, not the preflight one", async () => {
  // preflight: catalog synced exactly (missing=0); fresh: catalog empty (missing=[CAP_A])
  const preflight = mkObserved({ capabilityCatalog: [{ key: "CAP_A", label: "LABEL_A", isActive: true }] });
  const { code, spy } = await run(argvApply(), { observed: preflight, fresh: EMPTY_OBSERVED });
  assert.equal(code, EXIT.OK);
  assert.equal(spy.writeInputs.length, 1);
  // fresh disposition -> CAP_A must be created, even though preflight said reusable
  assert.deepEqual([...spy.writeInputs[0].missingCatalogKeys], ["CAP_A"]);
});

test("29+30. only MISSING catalog entries are presented to the writer; reusable ones are not", async () => {
  // two-capability plan; fresh has CAP_A exact (reuse) and CAP_B missing
  const freshTwo = mkObserved({ capabilityCatalog: [{ key: "CAP_A", label: "LABEL_A", isActive: true }] });
  const { deps, spy } = makeDeps({ observed: EMPTY_OBSERVED, fresh: freshTwo, config: JSON.stringify(TWO_CAP_CONFIG) });
  // sanity: PLAN2 is the plan for this config
  assert.equal(PLAN2.capabilityCatalog.length, 2);
  const code = await runBootstrapOrchestration(argvApply(), deps);
  assert.equal(code, EXIT.OK);
  assert.equal(spy.writeInputs.length, 1);
  const missing = [...spy.writeInputs[0].missingCatalogKeys];
  assert.deepEqual(missing, ["CAP_B"]); // only the missing one
  assert.equal(missing.includes("CAP_A"), false); // reusable is never scheduled
});

test("31. a transaction failure returns STOP (1) and writes nothing durable", async () => {
  const writeFail = await run(argvApply(), { observed: EMPTY_OBSERVED, writeThrows: true });
  assert.equal(writeFail.code, EXIT.STOP);
  assert.equal(writeFail.spy.writeInputs.length, 0);
  assert.ok(writeFail.spy.logs.includes("result=TRANSACTION_FAILURE"));

  const txFail = await run(argvApply(), { observed: EMPTY_OBSERVED, txThrows: true });
  assert.equal(txFail.code, EXIT.STOP);
  assert.ok(txFail.spy.logs.includes("result=TRANSACTION_FAILURE"));
});

// ===========================================================================
// Cleanup + redaction + determinism + import safety (32–38)
// ===========================================================================

test("32. cleanup/disconnect occurs after success", async () => {
  const { code, spy } = await run(argvDry(), { observed: EMPTY_OBSERVED });
  assert.equal(code, EXIT.OK);
  assert.equal(spy.cleanupCalls, 1);
});

test("33. cleanup/disconnect occurs after CLI / target / conflict / transaction failure", async () => {
  const cli = await run(["--bogus"]);
  assert.equal(cli.spy.cleanupCalls, 1);

  const target = await run(argvDry(REF_A), { detected: { detectedProjectRef: REF_B } });
  assert.equal(target.spy.cleanupCalls, 1);

  const conflict = await run(argvDry(), {
    observed: mkObserved({ activityYears: [{ name: "YEAR-SYNTH", startDate: null, endDate: null }] }),
  });
  assert.equal(conflict.spy.cleanupCalls, 1);

  const tx = await run(argvApply(), { observed: EMPTY_OBSERVED, writeThrows: true });
  assert.equal(tx.spy.cleanupCalls, 1);
});

test("34. cleanup failure is deterministic and leaks nothing", async () => {
  const first = await run(argvDry(), { observed: EMPTY_OBSERVED, cleanupThrows: true });
  assert.equal(first.code, EXIT.STOP); // a successful run becomes an internal failure
  assert.ok(first.spy.logs.includes("result=CLEANUP_FAILURE"));
  assertNoSensitive(first.spy.logs);

  const second = await run(argvDry(), { observed: EMPTY_OBSERVED, cleanupThrows: true });
  assert.equal(second.code, first.code);
  assert.deepEqual(second.spy.logs, first.spy.logs);
});

test("35. sensitive config values, keys, labels, dates, refs, and paths never appear in output", async () => {
  const scenarios: Array<Promise<{ code: number; spy: Spy }>> = [
    run(argvDry(), { observed: EMPTY_OBSERVED }),
    run(argvApply(), { observed: EMPTY_OBSERVED }),
    run(argvApply(), { observed: exactObservedFor(PLAN) }),
    run(argvDry(), { observed: mkObserved({ activityYears: [{ name: "YEAR-SYNTH", startDate: null, endDate: null }] }) }),
    run(argvDry(REF_A), { detected: { detectedProjectRef: REF_B } }),
    run(argvDry(PROD_REF)),
    run(argvDry(), { config: "{ broken" }),
  ];
  for (const s of await Promise.all(scenarios)) assertNoSensitive(s.spy.logs);
});

test("36. importing the module causes no execution and is stable", async () => {
  const beforeExit = process.exitCode;
  const mod1 = await import("./bootstrap-isolated-instance");
  const mod2 = await import("./bootstrap-isolated-instance");
  assert.equal(mod1, mod2); // cached; import had no side effect worth re-running
  assert.equal(typeof mod1.runBootstrapOrchestration, "function");
  assert.equal(typeof mod1.parseCliArgs, "function");
  assert.equal(typeof mod1.parseConfigDocument, "function");
  // no Prisma client is constructed or exported here
  assert.equal((mod1 as Record<string, unknown>).PrismaClient, undefined);
  // importing did not run the gated CLI (would have set a non-zero exit code)
  assert.equal(process.exitCode, beforeExit);
});

test("37. repeated deeply-equal input yields deeply-equal output and call order", async () => {
  const a = await run(argvApply(), { observed: EMPTY_OBSERVED, fresh: EMPTY_OBSERVED });
  const b = await run(argvApply(), { observed: EMPTY_OBSERVED, fresh: EMPTY_OBSERVED });
  assert.equal(a.code, b.code);
  assert.deepEqual(a.spy.logs, b.spy.logs);
  assert.deepEqual(a.spy.events, b.spy.events);
  assert.deepEqual(a.spy.writeInputs, b.spy.writeInputs);
});

test("38. no test needs a database, env value, network, or Prisma (all effects are injected)", async () => {
  // The harness supplies every effect synthetically; a run completes with no fs/env/DB.
  const { code, spy } = await run(argvDry(), { observed: EMPTY_OBSERVED });
  assert.equal(code, EXIT.OK);
  assert.ok(spy.logs.length > 0);
  // the module under test imports only the pure S1 plan + node:url — never Prisma
  const mod = await import("./bootstrap-isolated-instance");
  assert.equal((mod as Record<string, unknown>).PrismaClient, undefined);
});
