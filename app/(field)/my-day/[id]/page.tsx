"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatMoney } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useMyDay, useFieldStart, useFieldComplete } from "@/features/field/hooks";

export default function FieldJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const myDay = useMyDay();
  const start = useFieldStart();
  const complete = useFieldComplete();
  const [error, setError] = useState<string | null>(null);
  const onError = (err: unknown) => setError(userMessage(err));

  if (myDay.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (myDay.isError) return <p className="text-sm text-red">{userMessage(myDay.error)}</p>;
  const job = (myDay.data?.items ?? []).find((j) => j.id === id);
  if (!job) {
    return (
      <div className="space-y-3">
        <p className="text-sm">This job is done or no longer assigned to you.</p>
        <Link className="text-sm underline" href="/my-day">Back to My Day</Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Link className="text-sm text-ink-muted underline" href="/my-day">← My Day</Link>
      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-display text-lg font-semibold">{job.num} — {job.title ?? "untitled"}</p>
          <Badge tone={JOB_STATUS_TONE[job.status] ?? "neutral"}>{job.status.replace("_", " ")}</Badge>
        </div>
        <p className="text-sm text-ink-muted">Scheduled {formatDateTime(job.scheduledStart)}</p>
        <p className="text-sm">{formatMoney(job.total.cents)}</p>
      </Card>
      {error ? <p className="text-sm text-red">{error}</p> : null}
      {job.status === "scheduled" ? (
        <Button className="min-h-14 w-full text-base" disabled={start.isPending} onClick={() => start.mutate({ jobId: id }, { onError })}>
          Start job
        </Button>
      ) : null}
      {job.status === "in_progress" ? (
        <Button className="min-h-14 w-full text-base" disabled={complete.isPending}
          onClick={() => complete.mutate({ jobId: id }, { onSuccess: () => router.push("/my-day"), onError })}>
          Mark complete
        </Button>
      ) : null}
    </div>
  );
}
