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
import { useAppStore } from "@/lib/store/app-store";

/** Card-body skeleton shown while the fetch is in flight. */
function JobCardSkeleton() {
  return (
    <>
      {/* Card block 1 */}
      <div className="sk-row">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="sk" style={{ width: "70%", height: 14 }} />
          <div className="sk" style={{ width: "50%", height: 12 }} />
        </div>
      </div>
      {/* Card block 2 */}
      <div className="sk-row">
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="sk" style={{ width: "60%", height: 14 }} />
          <div className="sk" style={{ width: "45%", height: 12 }} />
        </div>
      </div>
    </>
  );
}

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

  // Cache-first: read the store job for the title so the header paints instantly
  // while the DTO fetch is in flight.  The store job is a different shape (no num,
  // no money, different status vocabulary) so we only use its title here; the full
  // card and actions wait for the DTO (they're below the fold of perception).
  const storeTitle = useAppStore((s) => s.jobs.find((j) => j.id === id)?.title ?? null);

  if (job.isError) return <p className="text-sm text-red">{userMessage(job.error)}</p>;
  if (job.isLoading) return (
    <div style={{ padding: "0 0 24px" }}>
      {/* Paint the title instantly when the store already has the job (warm nav);
          fall back to a title-bar skeleton for a cold deep-link. */}
      {storeTitle !== null ? (
        <PageHeader title={storeTitle} />
      ) : (
        <div className="sk-row" style={{ borderBottom: "none", paddingBottom: 20 }}>
          <div className="sk" style={{ width: "40%", height: 24 }} />
        </div>
      )}
      <JobCardSkeleton />
    </div>
  );
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
