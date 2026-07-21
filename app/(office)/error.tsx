"use client";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ padding: "var(--space-6)" }}>
      <p style={{ fontWeight: 500 }}>Something went wrong.</p>
      <Button variant="quiet" style={{ marginTop: "var(--space-3)" }} onClick={reset}>Try again</Button>
    </div>
  );
}
