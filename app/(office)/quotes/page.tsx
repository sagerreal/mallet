"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { formatMoney } from "@/lib/format";
import { ESTIMATE_STATUS_TONE } from "@/lib/labels";
import { userMessage } from "@/lib/trpc/error-map";
import { useQuotes } from "@/features/quotes/hooks";

const STATUSES = ["draft", "sent", "accepted", "declined"] as const;

export default function QuotesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "">("");
  const quotes = useQuotes(status || undefined);

  return (
    <div>
      <PageHeader title="Quotes" action={<Button onClick={() => router.push("/quotes/new")}>New quote</Button>} />
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
      {quotes.isError ? (
        <p className="text-sm text-red">{userMessage(quotes.error)}</p>
      ) : quotes.isLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <DataTable
          columns={[
            { key: "num", header: "Quote", render: (r) => r.num },
            { key: "title", header: "Title", render: (r) => r.title ?? "—", hideOnMobile: true },
            {
              key: "status",
              header: "Status",
              render: (r) => (
                <Badge tone={ESTIMATE_STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
              ),
            },
            { key: "total", header: "Total", render: (r) => formatMoney(r.total.cents) },
          ]}
          rows={quotes.data?.items ?? []}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/quotes/${r.id}`)}
          empty={
            <EmptyState
              title="No quotes yet"
              action={<Button onClick={() => router.push("/quotes/new")}>New quote</Button>}
            />
          }
        />
      )}
    </div>
  );
}
