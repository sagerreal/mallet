"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { LEAD_STAGE_TONE } from "@/lib/labels";
import { useCustomers } from "@/features/customers/hooks";
import { NewCustomerSheet } from "@/features/customers/new-customer-sheet";
import { userMessage } from "@/lib/trpc/error-map";

export default function CustomersPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const customers = useCustomers();
  const rows = customers.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Customers" action={<Button onClick={() => setCreating(true)}>New customer</Button>} />
      <NewCustomerSheet open={creating} onClose={() => setCreating(false)} />
      {customers.isError ? (
        <p className="text-sm text-red">{userMessage(customers.error)}</p>
      ) : customers.isLoading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <DataTable
          columns={[
            { key: "name", header: "Name", render: (r) => r.name },
            { key: "phone", header: "Phone", render: (r) => r.phone ?? "—", hideOnMobile: true },
            { key: "stage", header: "Stage", render: (r) => <Badge tone={LEAD_STAGE_TONE[r.stage] ?? "neutral"}>{r.stage.replace("_", " ")}</Badge> },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/customers/${r.id}`)}
          empty={<EmptyState title="No customers yet" hint="Add your first customer to start quoting." action={<Button onClick={() => setCreating(true)}>New customer</Button>} />}
        />
      )}
    </div>
  );
}
