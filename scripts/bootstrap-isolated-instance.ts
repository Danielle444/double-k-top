/**
 * MC-BOOTSTRAP-S2A — PURE orchestration + CLI/configuration boundary for the
 * FUTURE isolated-instance bootstrap runner. See MC-BOOTSTRAP-S2-DESIGN and the
 * MC-BOOTSTRAP-S2-RECONCILIATION report.
 *
 * DATABASE-FREE BY CONSTRUCTION. This stage deliberately contains NO PrismaClient,
 * NO Prisma import, NO database connection, NO real structural query, NO real
 * transaction, NO real write, NO DATABASE_URL / env read, NO Supabase, NO
 * capability-admin, NO migration/seed, NO network. Every effectful capability
 * (config-file read, target detection, structural reads, transactional apply,
 * cleanup, logging) is an INJECTED dependency (OrchestrationDeps). The real, safe
 * connection-metadata + Prisma adapter is provided later by S2B; see the bottom
 * of this file for exactly what remains to wire.
 *
 * S1 REMAINS THE POLICY AUTHORITY. This module imports the committed pure S1
 * contract and never re-implements domain validation, date rules, target
 * production/ref policy, entity-conflict rules, aggregate bootstrap rules, the
 * missing/reusable global-catalog semantics, or rerun semantics. The strict CLI
 * and JSON-shape / unknown-key boundary here is the ONLY additional policy: it
 * tightens the external input contract without weakening (or modifying) S1.
 *
 * IMPORT-SAFE: importing this module runs nothing — no I/O, no env read, no
 * logging, no Prisma. The gated CLI entry at the bottom executes ONLY when this
 * file is the invoked entry module, and even then it is explicitly NON-LIVE (it
 * refuses before touching any target, because the live adapter is S2B's job).
 */
import { pathToFileURL } from "node:url";
import {
  parseBootstrapConfig,
  buildBootstrapPlan,
  decideTargetSafety,
  classifyAggregateBootstrapState,
  type BootstrapCreationPlan,
  type ObservedStructuralState,
  type AggregateBootstrapDecision,
  type TargetSafetyDecision,
} from "./bootstrap-isolated-instance.plan";

// ===========================================================================
// Exit-code contract (explicit + tested). NEVER call process.exit() in the
// orchestration — return the code so cleanup completes and tests stay
// deterministic.
// ===========================================================================

export const EXIT = {
  /** successful dry-run, exact-rerun no-op, or successful injected apply. */
  OK: 0,
  /** bootstrap conflict, target-safety rejection, or injected apply/tx failure. */
  STOP: 1,
  /** CLI, file-loading, JSON, config-shape, or S1 validation failure. */
  INPUT: 2,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

// ===========================================================================
// A) Strict CLI parsing — supports both `--flag value` and `--flag=value`.
// ===========================================================================

export type CliParseResult =
  | {
      readonly ok: true;
      readonly configPath: string;
      readonly expectedTargetRef: string;
      readonly apply: boolean;
    }
  | { readonly ok: false; readonly errors: readonly string[] };

const VALUE_FLAGS = new Set(["--config", "--expected-target-ref"]);

/**
 * Parse AND validate argv. Errors carry only fixed CLI vocabulary (flag names) —
 * never a supplied value, path, or ref. `--config` and `--expected-target-ref`
 * are each required exactly once; `--apply` is an optional boolean at most once;
 * duplicates, missing/empty values, positional args and unknown flags are all
 * rejected. There is deliberately NO --force/--repair/--skip-checks/override.
 */
export function parseCliArgs(argv: readonly string[]): CliParseResult {
  const errors: string[] = [];
  let configPath: string | null = null;
  let configSeen = 0;
  let expectedTargetRef: string | null = null;
  let refSeen = 0;
  let applySeen = 0;

  const tokens = [...argv];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok === "--apply") {
      applySeen++;
      continue;
    }

    // Split a possible inline `--flag=value` form.
    let name = tok;
    let inlineValue: string | null = null;
    if (tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        name = tok.slice(0, eq);
        inlineValue = tok.slice(eq + 1);
      }
    }

    if (VALUE_FLAGS.has(name)) {
      let value: string | null;
      if (inlineValue !== null) {
        value = inlineValue;
      } else {
        const next = tokens[i + 1];
        if (next === undefined || next.startsWith("--")) {
          errors.push(`missing value for ${name}`);
          value = null;
        } else {
          value = next;
          i++; // consume the value token
        }
      }
      if (value !== null && value.trim().length === 0) {
        errors.push(`empty value for ${name}`);
        value = null;
      }
      if (name === "--config") {
        configSeen++;
        if (value !== null) configPath = value;
      } else {
        refSeen++;
        if (value !== null) expectedTargetRef = value;
      }
      continue;
    }

    if (tok.startsWith("--")) {
      errors.push(`unknown flag ${name}`);
      continue;
    }

    errors.push("unexpected positional argument");
  }

  if (applySeen > 1) errors.push("duplicate flag --apply");
  if (configSeen === 0) errors.push("missing required flag --config");
  if (configSeen > 1) errors.push("duplicate flag --config");
  if (refSeen === 0) errors.push("missing required flag --expected-target-ref");
  if (refSeen > 1) errors.push("duplicate flag --expected-target-ref");

  if (errors.length > 0 || configPath === null || expectedTargetRef === null) {
    return { ok: false, errors };
  }
  return { ok: true, configPath, expectedTargetRef, apply: applySeen === 1 };
}

// ===========================================================================
// B) Strict JSON object-shape + unknown-key boundary. Domain validation is
//    delegated to S1; this only enforces "one top-level object" and "no unknown
//    key at any level" so the external contract stays strict even though S1
//    itself tolerates unknown keys. S1 is NOT modified to achieve this.
// ===========================================================================

/** A redacted boundary issue: a structural location + a stable code, no values. */
export interface ConfigBoundaryIssue {
  readonly path: string;
  readonly code: string;
}

export type ConfigDocumentResult =
  | { readonly ok: true; readonly raw: Record<string, unknown> }
  | { readonly ok: false; readonly issues: readonly ConfigBoundaryIssue[] };

const TOP_KEYS = new Set(["activityYear", "offering", "groups", "capabilities"]);
const YEAR_KEYS = new Set(["name", "startDate", "endDate"]);
const OFFERING_KEYS = new Set(["name", "level", "startDate", "endDate", "status"]);
const GROUP_KEYS = new Set(["name", "subgroups"]);
const SUBGROUP_KEYS = new Set(["name"]);
const CAPABILITY_KEYS = new Set(["key", "label", "isActive", "offeringStatus"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pushUnknownKeys(
  obj: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  out: ConfigBoundaryIssue[],
): void {
  for (const key of Object.keys(obj)) {
    // Never echo the offending key literal — only the structural location.
    if (!allowed.has(key)) out.push({ path, code: "config.unknownKey" });
  }
}

/**
 * Collect unknown keys at EVERY configuration level. Recurse only where the value
 * already has the right container type; a wrong type is left for S1 to report, so
 * this boundary never duplicates S1's domain/type validation.
 */
function collectUnknownKeys(raw: Record<string, unknown>): ConfigBoundaryIssue[] {
  const out: ConfigBoundaryIssue[] = [];
  pushUnknownKeys(raw, TOP_KEYS, "config", out);

  if (isPlainObject(raw.activityYear)) {
    pushUnknownKeys(raw.activityYear, YEAR_KEYS, "config.activityYear", out);
  }
  if (isPlainObject(raw.offering)) {
    pushUnknownKeys(raw.offering, OFFERING_KEYS, "config.offering", out);
  }
  if (Array.isArray(raw.groups)) {
    raw.groups.forEach((g, i) => {
      if (!isPlainObject(g)) return;
      pushUnknownKeys(g, GROUP_KEYS, `config.groups[${i}]`, out);
      if (Array.isArray(g.subgroups)) {
        g.subgroups.forEach((s, j) => {
          if (isPlainObject(s)) pushUnknownKeys(s, SUBGROUP_KEYS, `config.groups[${i}].subgroups[${j}]`, out);
        });
      }
    });
  }
  if (Array.isArray(raw.capabilities)) {
    raw.capabilities.forEach((c, i) => {
      if (isPlainObject(c)) pushUnknownKeys(c, CAPABILITY_KEYS, `config.capabilities[${i}]`, out);
    });
  }
  return out;
}

/**
 * Parse the raw config text into a single top-level JSON object, rejecting
 * malformed JSON, a non-object root, and any unknown key. The returned `raw` is
 * handed UNCHANGED to S1's parseBootstrapConfig for domain validation.
 */
export function parseConfigDocument(text: string): ConfigDocumentResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: "config", code: "config.invalidJson" }] };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, issues: [{ path: "config", code: "config.notObject" }] };
  }
  const unknown = collectUnknownKeys(parsed);
  if (unknown.length > 0) return { ok: false, issues: unknown };
  return { ok: true, raw: parsed };
}

// ===========================================================================
// C) Injected dependency interfaces (no live adapter in S2A).
// ===========================================================================

/** Result of the injected, safe target-identity detection (S2B supplies the real one). */
export interface DetectedTarget {
  /** The Supabase project ref parsed from safe connection metadata, or null. */
  readonly detectedProjectRef: string | null;
}

/** What the (future, atomic) writer is asked to persist. Reusable catalog keys are absent. */
export interface BootstrapWriteInput {
  readonly plan: BootstrapCreationPlan;
  /** ONLY the requested catalog keys S1 classified as missing — never reusable ones. */
  readonly missingCatalogKeys: readonly string[];
}

/**
 * The injected transaction handle. In S2B this wraps a Prisma interactive
 * transaction; in S2A it is a synthetic fake. `readFresh` re-reads the COMPLETE
 * structural state inside the transaction; `writeBootstrap` performs the atomic
 * catalog + spine writes. S2A models the sequence but performs no real I/O.
 */
export interface ApplyTransaction {
  readFresh(): Promise<ObservedStructuralState>;
  writeBootstrap(input: BootstrapWriteInput): Promise<void>;
}

/**
 * Every effectful capability the orchestration needs, injected. NONE of these is
 * implemented against a live database in S2A.
 */
export interface OrchestrationDeps {
  /** Read the UTF-8 config file contents; throws on any I/O error. */
  readConfigFile(configPath: string): string;
  /** Detect the connected target ref from safe metadata; may throw or return null ref. */
  detectTarget(): DetectedTarget;
  /** Preflight read of the complete structural state (unfiltered). */
  readStructuralState(): Promise<ObservedStructuralState>;
  /** Open a transaction, run `work`, and (in S2B) commit/rollback atomically. */
  withTransaction<T>(work: (tx: ApplyTransaction) => Promise<T>): Promise<T>;
  /** Release resources (disconnect). Always invoked exactly once, on every path. */
  cleanup(): Promise<void>;
  /** Redacted, deterministic reporting sink. */
  log(line: string): void;
}

// ===========================================================================
// D) Deterministic, redacted reporting. Only safe categories + counts. Never a
//    name, label, date, capability key, logical ref, generated id, target ref,
//    config path, connection string, credential, or raw error.
// ===========================================================================

interface PlanCounts {
  readonly activityYear: number;
  readonly courseOffering: number;
  readonly groupsTotal: number;
  readonly groupsTopLevel: number;
  readonly capabilityCatalog: number;
  readonly offeringCapabilities: number;
}

interface OrchestrationReport {
  readonly mode: "DRY_RUN" | "APPLY_REQUESTED";
  readonly result: string;
  readonly stage?: string;
  readonly inputErrorCount?: number;
  readonly issueCodes?: readonly string[];
  readonly decision?: AggregateBootstrapDecision["kind"];
  readonly stopReason?: string;
  readonly targetKind?: TargetSafetyDecision["kind"];
  readonly targetWhich?: "expected" | "detected" | "both";
  readonly planCounts?: PlanCounts;
  readonly catalogMissing?: number;
  readonly catalogReusable?: number;
  readonly freshDecision?: AggregateBootstrapDecision["kind"];
}

function planCountsOf(plan: BootstrapCreationPlan): PlanCounts {
  return {
    activityYear: 1,
    courseOffering: 1,
    groupsTotal: plan.courseGroups.length,
    groupsTopLevel: plan.courseGroups.filter((g) => g.parentGroupRef === null).length,
    capabilityCatalog: plan.capabilityCatalog.length,
    offeringCapabilities: plan.offeringCapabilities.length,
  };
}

function writeReport(deps: OrchestrationDeps, r: OrchestrationReport): void {
  deps.log(`mode=${r.mode}`);
  deps.log(`result=${r.result}`);
  if (r.stage !== undefined) deps.log(`stage=${r.stage}`);
  if (r.inputErrorCount !== undefined) deps.log(`inputErrorCount=${r.inputErrorCount}`);
  if (r.issueCodes !== undefined && r.issueCodes.length > 0) deps.log(`issueCodes=${r.issueCodes.join(",")}`);
  if (r.decision !== undefined) deps.log(`decision=${r.decision}`);
  if (r.stopReason !== undefined) deps.log(`stopReason=${r.stopReason}`);
  if (r.targetKind !== undefined) deps.log(`targetKind=${r.targetKind}`);
  if (r.targetWhich !== undefined) deps.log(`targetWhich=${r.targetWhich}`);
  if (r.planCounts !== undefined) {
    deps.log(`plan.activityYear=${r.planCounts.activityYear}`);
    deps.log(`plan.courseOffering=${r.planCounts.courseOffering}`);
    deps.log(`plan.groupsTotal=${r.planCounts.groupsTotal}`);
    deps.log(`plan.groupsTopLevel=${r.planCounts.groupsTopLevel}`);
    deps.log(`plan.capabilityCatalog=${r.planCounts.capabilityCatalog}`);
    deps.log(`plan.offeringCapabilities=${r.planCounts.offeringCapabilities}`);
  }
  if (r.catalogMissing !== undefined) deps.log(`catalog.missing=${r.catalogMissing}`);
  if (r.catalogReusable !== undefined) deps.log(`catalog.reusable=${r.catalogReusable}`);
  if (r.freshDecision !== undefined) deps.log(`transaction.freshDecision=${r.freshDecision}`);
}

// ===========================================================================
// E) The orchestration itself. Pure control flow over injected effects; S1 owns
//    every domain decision. Returns an exit code (never process.exit()).
// ===========================================================================

async function runCore(argv: readonly string[], deps: OrchestrationDeps): Promise<number> {
  const cli = parseCliArgs(argv);
  if (!cli.ok) {
    writeReport(deps, { mode: "DRY_RUN", result: "INVALID_INPUT", stage: "cli", inputErrorCount: cli.errors.length });
    return EXIT.INPUT;
  }
  const mode: OrchestrationReport["mode"] = cli.apply ? "APPLY_REQUESTED" : "DRY_RUN";

  // 1) Load the config file (injected; throws on I/O error).
  let text: string;
  try {
    text = deps.readConfigFile(cli.configPath);
  } catch {
    writeReport(deps, { mode, result: "INVALID_INPUT", stage: "file" });
    return EXIT.INPUT;
  }

  // 2) Strict JSON object-shape + unknown-key boundary.
  const doc = parseConfigDocument(text);
  if (!doc.ok) {
    writeReport(deps, { mode, result: "INVALID_INPUT", stage: "shape", issueCodes: doc.issues.map((i) => i.code) });
    return EXIT.INPUT;
  }

  // 3) S1 domain validation — BEFORE target detection (fail fast on bad config).
  const parsed = parseBootstrapConfig(doc.raw);
  if (!parsed.ok) {
    writeReport(deps, { mode, result: "INVALID_INPUT", stage: "config", issueCodes: parsed.issues.map((i) => i.code) });
    return EXIT.INPUT;
  }

  // 4) Injected target detection -> S1 target-safety (BEFORE any structural read).
  let detected: DetectedTarget;
  try {
    detected = deps.detectTarget();
  } catch {
    writeReport(deps, { mode, result: "TARGET_REJECTED", targetKind: "invalid_metadata" });
    return EXIT.STOP;
  }
  const safety = decideTargetSafety({
    expectedProjectRef: cli.expectedTargetRef,
    detectedProjectRef: detected.detectedProjectRef ?? "",
  });
  if (safety.kind !== "allowed") {
    writeReport(deps, {
      mode,
      result: "TARGET_REJECTED",
      targetKind: safety.kind,
      targetWhich: safety.kind === "production_ref_rejected" ? safety.which : undefined,
    });
    return EXIT.STOP;
  }

  // 5) Build the deterministic plan (pure S1) and read the observed state.
  const plan = buildBootstrapPlan(parsed.config);
  const observed = await deps.readStructuralState();

  // 6) Aggregate decision — the COMPLETE observed state is passed to S1 unchanged
  //    (no CapabilityCatalog or course-area filtering here).
  const decision = classifyAggregateBootstrapState(plan, observed);
  const planCounts = planCountsOf(plan);

  if (decision.kind === "STOP_CONFLICT") {
    writeReport(deps, {
      mode,
      result: "STOP_CONFLICT",
      decision: decision.kind,
      stopReason: decision.reason,
      issueCodes: decision.issues.map((i) => i.code),
      planCounts,
    });
    return EXIT.STOP;
  }

  if (decision.kind === "EXACT_RERUN_NOOP") {
    // No writes, even with --apply.
    writeReport(deps, { mode, result: "EXACT_RERUN_NOOP", decision: decision.kind, planCounts });
    return EXIT.OK;
  }

  // decision.kind === "INITIAL_APPLY_ALLOWED"
  const preflightMissing = decision.catalog.missingKeys.length;
  const preflightReusable = decision.catalog.reusableKeys.length;

  if (!cli.apply) {
    // Dry-run: report the preflight plan + catalog disposition COUNTS; no writes.
    writeReport(deps, {
      mode,
      result: "INITIAL_APPLY_PLANNED",
      decision: decision.kind,
      planCounts,
      catalogMissing: preflightMissing,
      catalogReusable: preflightReusable,
    });
    return EXIT.OK;
  }

  // --apply: enter the injected transaction orchestration. Model the future S2B
  // sequence: re-read the complete state, RECLASSIFY via S1, proceed only if the
  // FRESH result is still INITIAL_APPLY_ALLOWED, and drive writes from the FRESH
  // in-transaction catalog disposition (never the preflight one).
  type ApplyOutcome =
    | { readonly kind: "written" }
    | { readonly kind: "aborted"; readonly freshKind: AggregateBootstrapDecision["kind"] };

  let outcome: ApplyOutcome;
  try {
    outcome = await deps.withTransaction<ApplyOutcome>(async (tx) => {
      const fresh = await tx.readFresh();
      const freshDecision = classifyAggregateBootstrapState(plan, fresh);
      if (freshDecision.kind !== "INITIAL_APPLY_ALLOWED") {
        return { kind: "aborted", freshKind: freshDecision.kind };
      }
      await tx.writeBootstrap({ plan, missingCatalogKeys: freshDecision.catalog.missingKeys });
      return { kind: "written" };
    });
  } catch {
    writeReport(deps, { mode, result: "TRANSACTION_FAILURE", decision: decision.kind, planCounts });
    return EXIT.STOP;
  }

  if (outcome.kind === "aborted") {
    writeReport(deps, {
      mode,
      result: "CONCURRENT_MODIFICATION",
      decision: decision.kind,
      freshDecision: outcome.freshKind,
      planCounts,
    });
    return EXIT.STOP;
  }

  writeReport(deps, {
    mode,
    result: "APPLY_ORCHESTRATED",
    decision: decision.kind,
    planCounts,
    catalogMissing: preflightMissing,
    catalogReusable: preflightReusable,
  });
  return EXIT.OK;
}

/**
 * Orchestrate one bootstrap run and return an exit code. Guarantees a single
 * `deps.cleanup()` on EVERY path (success, conflict, invalid input, target
 * rejection, transaction failure, or an unexpected internal error). Cleanup
 * failure is handled deterministically and never leaks a secret; it never
 * downgrades an already-failing code, but turns an otherwise-successful run into
 * an internal failure.
 */
export async function runBootstrapOrchestration(
  argv: readonly string[],
  deps: OrchestrationDeps,
): Promise<number> {
  let code: number;
  try {
    code = await runCore(argv, deps);
  } catch {
    // Redacted: never surface a raw error, stack, or supplied value.
    deps.log("mode=DRY_RUN");
    deps.log("result=INTERNAL_FAILURE");
    code = EXIT.STOP;
  }

  try {
    await deps.cleanup();
  } catch {
    deps.log("result=CLEANUP_FAILURE");
    if (code === EXIT.OK) code = EXIT.STOP;
  }
  return code;
}

// ===========================================================================
// F) Import-safe, explicitly NON-LIVE CLI entry. Runs ONLY when this file is the
//    invoked entry module. It never constructs a database adapter, never reads
//    DATABASE_URL / env, never connects, and refuses before any target work —
//    the live adapter is S2B. This exists so the executable boundary is real yet
//    cannot accidentally connect or apply.
// ===========================================================================

/** Human-facing, redacted CLI. Validates the arg contract, then refuses (non-live). */
export async function mainCli(argv: readonly string[]): Promise<number> {
  const cli = parseCliArgs(argv);
  if (!cli.ok) {
    for (const e of cli.errors) console.error(`REFUSED: ${e}`);
    return EXIT.INPUT;
  }
  console.error(
    "REFUSED: this is the S2A orchestration boundary. The live target-identity and " +
      "database adapter (safe connection metadata, structural reads, transactional " +
      "apply, disconnect) is provided by S2B and is intentionally NOT wired here. No " +
      "database, environment value, or network was accessed.",
  );
  return EXIT.STOP;
}

/** True only when this module is the process entry point (never during import/tests). */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  void mainCli(process.argv.slice(2)).then(
    (code) => {
      if (code !== 0) process.exitCode = code;
    },
    () => {
      process.exitCode = EXIT.STOP;
    },
  );
}
