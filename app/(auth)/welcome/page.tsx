"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { useEnsureProvisioned } from "@/features/identity/hooks";
import { userMessage } from "@/lib/trpc/error-map";

export default function WelcomePage() {
  const router = useRouter();
  const provision = useEnsureProvisioned();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    provision.mutate({}, { onSuccess: (me) => router.replace(me.role === "tech" ? "/my-day" : "/dashboard") });
  }, [provision, router]);

  return (
    <Card>
      {provision.isError ? (
        <p className="text-sm" style={{ color: "var(--red)" }}>{userMessage(provision.error)}</p>
      ) : (
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>Setting up your workspace…</p>
      )}
    </Card>
  );
}
