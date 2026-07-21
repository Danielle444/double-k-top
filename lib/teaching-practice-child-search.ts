// Pure, DB-free, JSX-free client-side search over the Teaching Practice
// children ("ילדים") registry. The admin Children tab already loads the full
// child list into the client, so filtering is a pure array operation - this
// helper is the single source of truth for what "matches" a query.
//
// Deliberately simple substring matching, NOT fuzzy/transliterated/Hebrew
// final-letter-normalized: the admin is looking up a known child by a prefix
// or fragment of a real display name / parent name / phone, so a plain
// normalized `includes` is both predictable and correct.

import { normalizeParentPhone } from "./teaching-practice-same-parent";

// Minimal shape this search reads - a subset of TeachingPracticeChildRow, so
// the real row type (which has more fields) is assignable to it. Only these
// three fields are ever searched; notes/age/gender/horse/ids/dates are not.
export interface ChildSearchable {
  fullName: string;
  parentName: string | null;
  parentPhone: string | null;
}

// Text normalization for name / parent-name matching: trim, collapse any run
// of whitespace to a single space, and lowercase (only affects Latin text -
// Hebrew has no case). Deliberately performs NO Hebrew final-letter
// conversion, fuzzy matching, or transliteration.
function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// True when the child matches the raw query. An empty / whitespace-only query
// matches every child (the caller shows the full list). Phone matching strips
// punctuation from BOTH the query and the stored phone (via the shared
// same-parent helper, whose semantics match exactly) so "050-123", "(050) 123"
// and "050123" all behave identically in either direction.
export function matchesChildSearch(child: ChildSearchable, rawQuery: string): boolean {
  const textQuery = normalizeText(rawQuery);
  if (textQuery === "") return true;

  if (normalizeText(child.fullName).includes(textQuery)) return true;
  if (child.parentName && normalizeText(child.parentName).includes(textQuery)) return true;

  const phoneQuery = normalizeParentPhone(rawQuery.trim());
  if (phoneQuery !== "" && child.parentPhone) {
    if (normalizeParentPhone(child.parentPhone).includes(phoneQuery)) return true;
  }

  return false;
}

// Filters a children list by the raw query, preserving source order and never
// mutating the input. An empty / whitespace-only query returns a shallow copy
// of the full list (so callers can render it without touching the original).
export function filterChildren<T extends ChildSearchable>(
  children: readonly T[],
  rawQuery: string,
): T[] {
  if (normalizeText(rawQuery) === "") return children.slice();
  return children.filter((child) => matchesChildSearch(child, rawQuery));
}
