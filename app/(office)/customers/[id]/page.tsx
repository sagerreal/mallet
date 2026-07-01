"use client";
import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatMoney, formatDateTime } from "@/lib/format";
import { LEAD_STAGE_TONE, ESTIMATE_STATUS_TONE, JOB_STATUS_TONE } from "@/lib/labels";
import { useCustomer } from "@/features/customers/hooks";

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const customer = useCustomer(id);
  const quotes = api.v1.quoting.list.useQuery({ limit: 100 });
  const jobs = api.v1.jobs.listByLead.useQuery({ leadId: id });

  if (customer.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!customer.data) return <p className="text-sm text-ink-muted">Customer not found.</p>;
  const c = customer.data;
  const customerQuotes = (quotes.data?.items ?? []).filter((q) => q.leadId === id);

  return (
    <div className="space-y-4">
      <PageHeader title={c.name} action={<Button onClick={() => router.push(`/quotes/new?leadId=${id}`)}>New quote</Button>} />
      <Card className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone={LEAD_STAGE_TONE[c.stage] ?? "neutral"}>{c.stage.replace("_", " ")}</Badge>
        <span>{c.phone ?? "no phone"}</span>
        <span className="text-ink-muted">{c.email ?? ""}</span>
      </Card>
      <Card>
        <h2 className="mb-2 font-display font-semibold">Quotes</h2>
        {customerQuotes.length === 0 ? <p className="text-sm text-ink-muted">No quotes yet.</p> : (
          <ul className="space-y-1 text-sm">
            {customerQuotes.map((q) => (
              <li key={q.id}>
                <Link className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper" href={`/quotes/${q.id}`}>
                  <span>{q.num} — {q.title ?? "untitled"}</span>
                  <span className="flex items-center gap-2"><Badge tone={ESTIMATE_STATUS_TONE[q.status] ?? "neutral"}>{q.status}</Badge>{formatMoney(q.total.cents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-display font-semibold">Jobs</h2>
        {(jobs.data?.items ?? []).length === 0 ? <p className="text-sm text-ink-muted">No jobs yet.</p> : (
          <ul className="space-y-1 text-sm">
            {(jobs.data?.items ?? []).map((j) => (
              <li key={j.id}>
                <Link className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper" href={`/jobs/${j.id}`}>
                  <span>{j.num} — {j.title ?? "untitled"}</span>
                  <span className="flex items-center gap-2"><Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>{formatDateTime(j.scheduledStart)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
