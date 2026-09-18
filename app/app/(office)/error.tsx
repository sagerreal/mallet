"use client";

import { RouteError } from "@/components/shared/route-error";

/** The office segment's crash screen — see RouteError for logging and stale-deploy recovery. */
export default function ErrorBoundary(props: { error: Error; reset: () => void }) {
  return <RouteError {...props} />;
}
