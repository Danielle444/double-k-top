"use client";

import { useEffect, useState } from "react";
import {
  getParentSignatureStatusForInstructor,
  type ParentSignatureStatusResult,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureStatusList } from "@/lib/components/ParentSignatureStatusList";

// Stage 2: read-only. The tab this renders under is only shown to
// instructors whose stored session has canManageChildSignatures=true (see
// InstructorClient), but that's a UX convenience only - the real gate is
// server-side in getParentSignatureStatusForInstructor, which re-checks the
// flag fresh from the DB and returns an empty result for anyone without it.
export function InstructorChildSignaturesSection({ instructorId }: { instructorId: string }) {
  const [data, setData] = useState<ParentSignatureStatusResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getParentSignatureStatusForInstructor(instructorId).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [instructorId]);

  return <ParentSignatureStatusList data={data} />;
}
