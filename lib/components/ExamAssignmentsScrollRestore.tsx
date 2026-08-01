"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll-position fix for the admin exam assignments workspace
 * (app/admin/courses/[courseOfferingId]/exams). Every save there is a
 * `<form action={...}>` whose Server Action ends in `redirect()` back to the
 * same route with a new feedback token. Next.js's documented default is to
 * scroll to the top of the page on that navigation whenever the top of the
 * page is out of the viewport — exactly the case for a manager scrolled deep
 * into the assignments list.
 *
 * The route's own components are deliberately held to zero client state or
 * effects by their own contract tests (page.tsx is a pure Server Component;
 * CreateExamAssignmentForm, DeleteExamAssignmentForm and
 * EditExamAssignmentCard are all swept for `useEffect`/`useState`/etc. by
 * name), so this fix lives one layer up — mounted once from the admin
 * layout — and only acts while the current route is this one.
 *
 * `pendingScrollY` is a plain in-memory module variable, not sessionStorage:
 * a Server Action's redirect() is a soft client-side navigation in the App
 * Router (no full page reload), so the module scope survives from "submit"
 * to "next render" on its own.
 */
let pendingScrollY: number | null = null;

const EXAM_ASSIGNMENTS_ROUTE = /^\/admin\/courses\/[^/]+\/exams(?:\/|$)/;

export function ExamAssignmentsScrollRestore() {
  const pathname = usePathname();
  const onRoute = EXAM_ASSIGNMENTS_ROUTE.test(pathname);

  useEffect(() => {
    if (!onRoute) return;
    const handleSubmit = (event: SubmitEvent) => {
      if (event.target instanceof HTMLFormElement) {
        pendingScrollY = window.scrollY;
      }
    };
    document.addEventListener("submit", handleSubmit, true);
    return () => document.removeEventListener("submit", handleSubmit, true);
  }, [onRoute]);

  useEffect(() => {
    if (!onRoute || pendingScrollY === null) return;
    const y = pendingScrollY;
    pendingScrollY = null;
    const frame = requestAnimationFrame(() => window.scrollTo(0, y));
    return () => cancelAnimationFrame(frame);
  });

  return null;
}
