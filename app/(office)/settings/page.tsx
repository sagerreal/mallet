"use client";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useMe } from "@/features/identity/hooks";
import { signOut } from "@/features/auth/hooks";

export default function SettingsPage() {
  const router = useRouter();
  const me = useMe();

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      <Card className="space-y-1 text-sm">
        <p><span className="text-ink-muted">Business:</span> {me.data?.orgName ?? "…"}</p>
        <p><span className="text-ink-muted">Signed in as:</span> {me.data?.email ?? "…"} ({me.data?.role ?? ""})</p>
      </Card>
      <Button variant="quiet" onClick={async () => { await signOut(); router.replace("/login"); }}>Sign out</Button>
    </div>
  );
}
