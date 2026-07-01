"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/format";
import { INVOICE_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useInvoices } from "@/features/invoices/hooks";

const STATUSES = ["draft", "sent", "partial", "paid", "void"] as const;

export default function MoneyPage() {
  const router = useRouter();
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "">("");
  const invoices = useInvoices(status || undefined);

  return (
    <div>
      <PageHeader title="Money" />
      <div className="mb-3 max-w-48">
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      {invoices.isError ? (
        <p className="text-sm text-red">{userMessage(invoices.error)}</p>
      ) : invoices.isLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <DataTable
          columns={[
            { key: "num", header: "Invoice", render: (r) => r.num },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <Badge tone={INVOICE_STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
              ),
            },
            { key: "total", header: "Total", render: (r) => formatMoney(r.total.cents) },
            { key: "due", header: "Due", render: (r) => formatMoney(r.due.cents) },
          ]}
          rows={invoices.data?.items ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/money/${r.id}`)}
          empty={
            <EmptyState
              title="No invoices yet"
              hint="Create one from a completed job."
            />
          }
        />
      )}
    </div>
  );
}
