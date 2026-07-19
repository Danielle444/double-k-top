/**
 * MULTI-COURSE (dormant foundation, Slice 5) - PURE core for the explicit,
 * already-scoped CourseOffering group hierarchy.
 *
 * PURE by construction: no Prisma, no DB, no clock, no randomness, no env, no
 * auth/session/cookie, no singleton resolver. It takes already-fetched
 * CourseGroup rows for EXACTLY ONE offering (the IO reader is responsible for the
 * courseOfferingId predicate) and produces a deterministic, read-only two-level
 * hierarchy plus an explicit, deterministic list of structural anomalies. The
 * whole contract is unit-testable without a database
 * (see course-group-tree-core.test.ts).
 *
 * Deliberate NON-responsibilities (kept out by design):
 *   - it reads NO Student, enrollment, membership or count data - the input row
 *     shape cannot even carry them;
 *   - it applies NO effective-date logic (that belongs to GroupMembership, which
 *     is not consulted here);
 *   - it NEVER throws for ordinary malformed hierarchy data (orphaned parent,
 *     self-reference, over-deep parent, duplicate id) - such rows are surfaced as
 *     structured anomalies with stable, non-PII reason codes, never silently
 *     dropped and never used to fabricate a parent node;
 *   - it never mutates its input.
 *
 * DORMANT: no runtime consumer imports this slice; nothing is wired.
 */

/**
 * One already-fetched CourseGroup row for a single offering. Mirrors exactly the
 * narrow `select` the Slice 5 IO reader issues (id, name, parentGroupId). Every
 * node name is derived from each row's OWN `name`, and a child's parent is
 * resolved from the actual parent row by id, so no parent-name projection is
 * needed. `parentGroupId` is nullable because the FK is optional (a top-level
 * group has no parent).
 */
export interface CourseGroupTreeRow {
  id: string;
  name: string;
  parentGroupId: string | null;
}

/** A read-only leaf subgroup node. Structural fields only - never PII. */
export interface CourseGroupSubgroupNode {
  readonly id: string;
  readonly name: string;
}

/** A read-only top-level group node with its ordered direct subgroups. */
export interface CourseGroupTopLevelNode {
  readonly id: string;
  readonly name: string;
  readonly subgroups: readonly CourseGroupSubgroupNode[];
}

/**
 * Stable, non-PII reason codes for a structurally malformed / unplaceable row.
 * They never contain a group name, offering name, actor identity or any PII -
 * only the code plus the row's own (public cuid) id and parentGroupId.
 *
 *   DUPLICATE_ID        - the row's id already appeared earlier in the input; the
 *                         first occurrence (input order) is authoritative, later
 *                         ones are here. This is defensive pure-core handling: a
 *                         real `courseGroup.findMany` cannot return two rows with
 *                         the same primary-key id, so this branch is unreachable
 *                         from the Slice 5 IO reader.
 *   SELF_REFERENCE      - parentGroupId === id (a row referencing itself).
 *   ORPHANED_PARENT     - parentGroupId is set but matches no row in the input.
 *   NON_TOPLEVEL_PARENT - parentGroupId resolves to a row that is itself a
 *                         subgroup (would exceed the two-level depth), so the row
 *                         cannot be attached without fabricating structure.
 */
export type CourseGroupTreeAnomalyReason =
  | "DUPLICATE_ID"
  | "SELF_REFERENCE"
  | "ORPHANED_PARENT"
  | "NON_TOPLEVEL_PARENT";

/** One reported anomaly. Structural, non-PII: id + parentGroupId + reason only. */
export interface CourseGroupTreeAnomaly {
  readonly id: string;
  readonly parentGroupId: string | null;
  readonly reason: CourseGroupTreeAnomalyReason;
}

/**
 * The deterministic, read-only hierarchy view for one offering: ordered
 * top-level groups (each with ordered subgroups) plus every anomaly, ordered
 * deterministically. Both lists are always present (possibly empty).
 */
export interface CourseGroupTreeView {
  readonly topLevel: readonly CourseGroupTopLevelNode[];
  readonly anomalies: readonly CourseGroupTreeAnomaly[];
}

/**
 * Total, deterministic comparator for group nodes: name ascending by Unicode
 * code point (env-independent, unlike locale collation), then id ascending as a
 * stable tie-break. The id (a unique primary key) makes the order fully
 * deterministic regardless of the underlying sort's stability or the input order.
 */
function compareNodeByNameThenId(
  a: { id: string; name: string },
  b: { id: string; name: string },
): number {
  if (a.name !== b.name) {
    return a.name < b.name ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  return 0;
}

/** Deterministic anomaly ordering rank (smaller = earlier). */
const ANOMALY_REASON_RANK: Record<CourseGroupTreeAnomalyReason, number> = {
  DUPLICATE_ID: 0,
  SELF_REFERENCE: 1,
  ORPHANED_PARENT: 2,
  NON_TOPLEVEL_PARENT: 3,
};

/**
 * Total, deterministic comparator for anomalies: id ascending, then reason rank,
 * then parentGroupId (null sorts as empty string). Two identical duplicate rows
 * compare equal, which is harmless because they produce identical anomaly objects.
 */
function compareAnomalies(a: CourseGroupTreeAnomaly, b: CourseGroupTreeAnomaly): number {
  if (a.id !== b.id) {
    return a.id < b.id ? -1 : 1;
  }
  const reasonDiff = ANOMALY_REASON_RANK[a.reason] - ANOMALY_REASON_RANK[b.reason];
  if (reasonDiff !== 0) {
    return reasonDiff;
  }
  const ap = a.parentGroupId ?? "";
  const bp = b.parentGroupId ?? "";
  if (ap !== bp) {
    return ap < bp ? -1 : 1;
  }
  return 0;
}

/**
 * Build the deterministic two-level group hierarchy for ONE offering from its
 * already-fetched rows. Never throws for malformed data and never mutates the
 * input.
 *
 * Classification order (a row is exactly one of these):
 *   1. DUPLICATE_ID    - id already seen (first occurrence wins, in input order);
 *   2. SELF_REFERENCE  - parentGroupId === id;
 *   3. top-level       - parentGroupId === null;
 *   4. ORPHANED_PARENT - parentGroupId set but not present among authoritative rows;
 *   5. NON_TOPLEVEL_PARENT - parent present but is itself a subgroup;
 *   6. child           - attached under its valid top-level parent.
 *
 * The self-reference check precedes parent resolution so a row that names itself
 * is reported as SELF_REFERENCE rather than treated as its own child.
 *
 * Determinism: the emitted node ordering and anomaly ordering are fully
 * deterministic (name-then-id / id-then-reason comparators), independent of input
 * order. The ONE input-order-dependent decision is which row wins for a duplicate
 * id: the first occurrence (Map insertion order) is authoritative and later ones
 * are DUPLICATE_ID. That only matters for defensive duplicate handling, which the
 * real primary-key query cannot produce.
 */
export function buildCourseGroupTree(
  rows: readonly CourseGroupTreeRow[],
): CourseGroupTreeView {
  const anomalies: CourseGroupTreeAnomaly[] = [];

  // Pass 1 - dedupe by id. The FIRST occurrence (input order) is authoritative;
  // any later row with the same id is a DUPLICATE_ID anomaly and is excluded
  // from the tree. This is the documented "default safely" behaviour. The Map
  // preserves first-occurrence insertion order, so it is the single source of
  // authoritative rows for pass 2 (no separate array needed).
  const byId = new Map<string, CourseGroupTreeRow>();
  for (const row of rows) {
    if (byId.has(row.id)) {
      anomalies.push({ id: row.id, parentGroupId: row.parentGroupId, reason: "DUPLICATE_ID" });
      continue;
    }
    byId.set(row.id, row);
  }

  // Pass 2 - classify each authoritative row (Map insertion order) and bucket
  // valid children.
  const topLevelRows: CourseGroupTreeRow[] = [];
  const childrenByParent = new Map<string, CourseGroupTreeRow[]>();
  for (const row of byId.values()) {
    // Self-reference first, before any parent lookup can treat it as a child.
    if (row.parentGroupId === row.id) {
      anomalies.push({ id: row.id, parentGroupId: row.parentGroupId, reason: "SELF_REFERENCE" });
      continue;
    }
    if (row.parentGroupId === null) {
      topLevelRows.push(row);
      continue;
    }
    const parent = byId.get(row.parentGroupId);
    if (parent === undefined) {
      // No fabrication: an unknown parent id is surfaced, not invented.
      anomalies.push({ id: row.id, parentGroupId: row.parentGroupId, reason: "ORPHANED_PARENT" });
      continue;
    }
    if (parent.parentGroupId !== null) {
      // Parent is itself a subgroup (or otherwise non-top-level) - attaching here
      // would exceed the two-level depth, so report rather than deepen the tree.
      anomalies.push({
        id: row.id,
        parentGroupId: row.parentGroupId,
        reason: "NON_TOPLEVEL_PARENT",
      });
      continue;
    }
    const bucket = childrenByParent.get(row.parentGroupId);
    if (bucket === undefined) {
      childrenByParent.set(row.parentGroupId, [row]);
    } else {
      bucket.push(row);
    }
  }

  // Assemble ordered top-level nodes, each with its ordered subgroups. `.map`
  // returns fresh arrays/objects, so the input rows are never mutated.
  const topLevel: CourseGroupTopLevelNode[] = topLevelRows
    .map((row) => {
      const subgroups: CourseGroupSubgroupNode[] = (childrenByParent.get(row.id) ?? [])
        .map((child) => ({ id: child.id, name: child.name }))
        .sort(compareNodeByNameThenId);
      return { id: row.id, name: row.name, subgroups };
    })
    .sort(compareNodeByNameThenId);

  // `anomalies` is a local array with no reference escaping before this point, so
  // sorting it in place is safe; the returned value is the only handle to it.
  anomalies.sort(compareAnomalies);
  return { topLevel, anomalies };
}
