"use client";

import { useEffect, useState } from "react";
import {
  getParentSignatureStatusForAdmin,
  type ParentSignatureStatusResult,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureStatusList } from "@/lib/components/ParentSignatureStatusList";

// Stage 2: read-only. Admin entry point - page.tsx already calls
// requireAdmin() server-side before rendering this at all.
export function ParentSignaturesAdminClient() {
  const [data, setData] = useState<ParentSignatureStatusResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    getParentSignatureStatusForAdmin().then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <ParentSignatureStatusList data={data} />;
}
