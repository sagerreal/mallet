"use client";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatMoney, formatDateTime } from "@/lib/format";
import { JOB_STATUS_TONE } from "@/lib/labels";
import { useJobs } from "@/features/jobs/hooks";
import { useInvoices } from "@/features/invoices/hooks";
import { useCustomers } from "@/features/customers/hooks";
import { userMessage } from "@/lib/trpc/error-map";

function Section({ title, href, children }: { title: string; href: string; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display font-semibold">{title}</h2>
        <Link href={href} className="text-sm text-ink-muted underline">View all</Link>
      </div>
      {children}
    </Card>
  );
}

export default function DashboardPage() {
  const scheduled = useJobs("scheduled");
  const inProgress = useJobs("in_progress");
  const sent = useInvoices("sent");
  const partial = useInvoices("partial");
  const customers = useCustomers();

  const jobsError = scheduled.isError || inProgress.isError;
  const invoicesError = sent.isError || partial.isError;

  const upcoming = [...(inProgress.data?.items ?? []), ...(scheduled.data?.items ?? [])].slice(0, 5);
  const unpaid = [...(partial.data?.items ?? []), ...(sent.data?.items ?? [])];
  const outstanding = unpaid.reduce((sum, inv) => sum + inv.due.cents, 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Home" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Today's work" href="/jobs">
          {jobsError
            ? <p className="text-sm text-red">{userMessage(scheduled.error ?? inProgress.error)}</p>
            : upcoming.length === 0
              ? <p className="text-sm text-ink-muted">Nothing scheduled.</p>
              : (
                <ul className="space-y-1 text-sm">
                  {upcoming.map((j) => (
                    <li key={j.id}>
                      <Link href={`/jobs/${j.id}`} className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper">
                        <span>{j.num} — {j.title ?? "untitled"}</span>
                        <span className="flex items-center gap-2"><Badge tone={JOB_STATUS_TONE[j.status] ?? "neutral"}>{j.status.replace("_", " ")}</Badge>{formatDateTime(j.scheduledStart)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
        </Section>
        <Section title={invoicesError ? "Outstanding" : `Waiting on ${formatMoney(outstanding)}`} href="/money">
          {invoicesError
            ? <p className="text-sm text-red">{userMessage(sent.error ?? partial.error)}</p>
            : unpaid.length === 0
              ? <p className="text-sm text-ink-muted">Nothing outstanding.</p>
              : (
                <ul className="space-y-1 text-sm">
                  {unpaid.slice(0, 5).map((inv) => (
                    <li key={inv.id}>
                      <Link href={`/money/${inv.id}`} className="flex justify-between rounded-control px-2 py-1.5 hover:bg-paper">
                        <span>{inv.num}</span><span>{formatMoney(inv.due.cents)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
        </Section>
        <Section title="Newest customers" href="/customers">
          {customers.isError
            ? <p className="text-sm text-red">{userMessage(customers.error)}</p>
            : (customers.data?.items ?? []).length === 0
              ? <p className="text-sm text-ink-muted">No customers yet.</p>
              : (
                <ul className="space-y-1 text-sm">
                  {(customers.data?.items ?? []).slice(0, 5).map((c) => (
                    <li key={c.id}><Link href={`/customers/${c.id}`} className="block rounded-control px-2 py-1.5 hover:bg-paper">{c.name}</Link></li>
                  ))}
                </ul>
              )}
        </Section>
      </div>
    </div>
  );
}
