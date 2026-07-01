"use client";
import { use } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useJob } from "@/features/jobs/hooks";
import { JobActions } from "@/features/jobs/job-actions";

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const job = useJob(id);

  if (job.isError) return <p className="text-sm text-red">{userMessage(job.error)}</p>;
  if (job.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!job.data) return <p className="text-sm text-ink-muted">Job not found.</p>;
  const j = job.data;

  return (
    <div className="space-y-4">
      <PageHeader title={`${j.num} — ${j.title ?? "untitled"}`} />
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
      <Card>
        <JobActions job={j} />
      </Card>
    </div>
  );
}
