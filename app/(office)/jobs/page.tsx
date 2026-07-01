"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney, formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useJobs } from "@/features/jobs/hooks";

const STATUSES = ["scheduled", "in_progress", "complete", "canceled"] as const;

export default function JobsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "">("");
  const jobs = useJobs(status || undefined);

  return (
    <div>
      <PageHeader title="Jobs" />
      <div className="mb-3 max-w-48">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </Select>
      </div>
      {jobs.isError ? (
        <p className="text-sm text-red">{userMessage(jobs.error)}</p>
      ) : jobs.isLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <DataTable
          columns={[
            { key: "num", header: "Job", render: (r) => r.num },
            { key: "title", header: "Title", render: (r) => r.title ?? "—", hideOnMobile: true },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <Badge tone={JOB_STATUS_TONE[r.status] ?? "neutral"}>
                  {r.status.replace("_", " ")}
                </Badge>
              ),
            },
            { key: "when", header: "When", render: (r) => formatDateTime(r.scheduledStart) },
            { key: "total", header: "Total", render: (r) => formatMoney(r.total.cents) },
          ]}
          rows={jobs.data?.items ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/jobs/${r.id}`)}
          empty={
            <EmptyState
              title="No jobs yet"
              hint="Jobs are created from accepted quotes."
            />
          }
        />
      )}
    </div>
  );
}
