"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatMoney, formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useJob, useCallbackCandidates, useConfirmCallback, useDismissCallback } from "@/features/jobs/hooks";
import { JobActions } from "@/features/jobs/job-actions";
import { useCreateInvoiceFromJob } from "@/features/invoices/hooks";

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const job = useJob(id);
  const router = useRouter();
  const createInvoice = useCreateInvoiceFromJob();
  const candidates = useCallbackCandidates();
  const confirmCallback = useConfirmCallback();
  const dismissCallback = useDismissCallback();
  const [error, setError] = useState<string | null>(null);
  const [cbError, setCbError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));
  const onCbError = (err: unknown) => setCbError(userMessage(err));

  if (job.isError) return <p className="text-sm text-red">{userMessage(job.error)}</p>;
  if (job.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!job.data) return <p className="text-sm text-ink-muted">Job not found.</p>;
  const j = job.data;

  const candidate = candidates.data?.find((c) => c.jobId === id) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader title={`${j.num} — ${j.title ?? "untitled"}`} />
      {candidate && j.callbackReason === null ? (
        <Card className="space-y-2 text-sm">
          <p className="font-medium">
            Looks like a callback of {candidate.original.num}
            {candidate.original.svc ? ` · ${candidate.original.svc}` : ""} — this {j.num} was booked for the same customer and service within 45 days.
          </p>
          {cbError ? <p className="text-red">{cbError}</p> : null}
          <div className="flex gap-2">
            <Button
              disabled={confirmCallback.isPending || dismissCallback.isPending}
              onClick={() => confirmCallback.mutate({ jobId: id, originalJobId: candidate.original.jobId, reason: "callback" }, { onError: onCbError })}
            >
              Confirm callback
            </Button>
            <Button
              disabled={confirmCallback.isPending || dismissCallback.isPending}
              onClick={() => dismissCallback.mutate({ jobId: id }, { onError: onCbError })}
            >
              Not a callback
            </Button>
          </div>
        </Card>
      ) : null}
      <Card className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>
          <span className="font-medium">{formatMoney(j.total.cents)}</span>
        </div>
        <p className="text-ink-muted">
          Scheduled {formatDateTime(j.scheduledStart)} → {formatDateTime(j.scheduledEnd)}
        </p>
        {j.cancelReason ? <p className="text-red">Canceled: {j.cancelReason}</p> : null}
      </Card>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      <Card>
        {j.status === "complete" ? (
          <Button
            disabled={createInvoice.isPending}
            onClick={() => createInvoice.mutate({ jobId: id }, { onSuccess: (inv) => router.push(`/money/${inv.id}`), onError })}
          >
            Create invoice
          </Button>
        ) : null}
        <JobActions job={j} />
      </Card>
    </div>
  );
}
