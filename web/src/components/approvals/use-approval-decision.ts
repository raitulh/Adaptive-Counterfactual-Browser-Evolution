"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { approvalsApi, type ApprovalOut } from "@/lib/api";
import { track } from "@/lib/analytics";
import { qk } from "@/lib/query/keys";
import { fingerprintOf, SubmissionKeyTracker } from "@/components/command-center/submission-key";

/**
 * Approve / reject one approval with an idempotency key per decision (reused when the same
 * decision is retried after an unknown outcome). The card only shows the backend's answer.
 */
export function useApprovalDecision(approval: Pick<ApprovalOut, "id" | "task_id" | "risk_level" | "tool_name">) {
  const queryClient = useQueryClient();
  const approveKeys = React.useRef(new SubmissionKeyTracker());
  const rejectKeys = React.useRef(new SubmissionKeyTracker());
  const [decided, setDecided] = React.useState<ApprovalOut | null>(null);

  const refresh = (result: ApprovalOut) => {
    setDecided(result);
    void queryClient.invalidateQueries({ queryKey: qk.approvals.all });
    void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(approval.task_id) });
    void queryClient.invalidateQueries({ queryKey: qk.tasks.summary(approval.task_id) });
    void queryClient.invalidateQueries({ queryKey: qk.tasks.lists });
  };

  const approve = useMutation({
    mutationFn: (note?: string) => {
      const key = approveKeys.current.keyFor(fingerprintOf({ id: approval.id, note: note ?? null }));
      return approvalsApi.approve(approval.id, key, note);
    },
    onSuccess: (result) => {
      approveKeys.current.succeeded();
      refresh(result);
      track("approval_approved", { risk_level: approval.risk_level, tool: approval.tool_name });
    },
    onError: (err) => approveKeys.current.failed(err),
  });

  const reject = useMutation({
    mutationFn: (reason: string) => {
      const key = rejectKeys.current.keyFor(fingerprintOf({ id: approval.id, reason }));
      return approvalsApi.reject(approval.id, key, reason);
    },
    onSuccess: (result) => {
      rejectKeys.current.succeeded();
      refresh(result);
      track("approval_rejected", { risk_level: approval.risk_level, tool: approval.tool_name });
    },
    onError: (err) => rejectKeys.current.failed(err),
  });

  return { approve, reject, decided };
}
