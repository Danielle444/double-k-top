"use client";

import { useCallback, useState } from "react";
import {
  getParentSignatureStatusForAdmin,
  submitTeachingPracticeSignedFormAsAdmin,
  getTeachingPracticeSignedFormForAdmin,
  getAllActiveTeachingPracticeSignedFormsForAdmin,
  type ParentSignatureSubmitInput,
} from "@/lib/actions/parent-signatures";
import { ParentSignatureStatusList } from "@/lib/components/ParentSignatureStatusList";
import { ParentSignatureBulkPrintModal } from "@/lib/components/ParentSignatureBulkPrintModal";
import { Button } from "@/lib/components/Button";

// Stage 2 read + Stage 3 sign + Stage 4 view + bulk print/export. Admin
// entry point - page.tsx already calls requireAdmin() server-side before
// rendering this at all, and every server action below calls requireAdmin()
// again itself.
export function ParentSignaturesAdminClient() {
  const fetchStatus = useCallback(() => getParentSignatureStatusForAdmin(), []);
  const submit = useCallback(
    (input: ParentSignatureSubmitInput) => submitTeachingPracticeSignedFormAsAdmin(input),
    []
  );
  const viewSignedForm = useCallback(
    (signedFormId: string) => getTeachingPracticeSignedFormForAdmin(signedFormId),
    []
  );
  const fetchAllSignedForms = useCallback(() => getAllActiveTeachingPracticeSignedFormsForAdmin(), []);

  const [bulkPrintOpen, setBulkPrintOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={() => setBulkPrintOpen(true)}>
          הדפסה / שמירה כ-PDF לכל הטפסים החתומים
        </Button>
      </div>
      <ParentSignatureStatusList fetchStatus={fetchStatus} submit={submit} viewSignedForm={viewSignedForm} />
      {bulkPrintOpen && (
        <ParentSignatureBulkPrintModal
          open={bulkPrintOpen}
          onClose={() => setBulkPrintOpen(false)}
          fetchData={fetchAllSignedForms}
        />
      )}
    </div>
  );
}
