"use client";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="p-6">
      <p className="font-medium">Something went wrong.</p>
      <Button variant="quiet" className="mt-3" onClick={reset}>Try again</Button>
    </div>
  );
}
