"use client";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useMyDay } from "@/features/field/hooks";

export default function MyDayPage() {
  const myDay = useMyDay();
  const jobs = myDay.data?.items ?? [];

  if (myDay.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (myDay.isError) return <p className="text-sm text-red">{userMessage(myDay.error)}</p>;
  if (jobs.length === 0) return <EmptyState title="No jobs assigned" hint="When the office assigns you work, it shows up here." />;

  return (
    <ul className="space-y-3">
      {jobs.map((j) => (
        <li key={j.id}>
          <Link href={`/my-day/${j.id}`}>
            <Card className="active:bg-paper">
              <div className="flex items-center justify-between">
                <p className="font-medium">{j.num} — {j.title ?? "untitled"}</p>
                <Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{formatDateTime(j.scheduledStart)}</p>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
