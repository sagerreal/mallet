"use client";

import { RouteError } from "@/components/shared/route-error";

/** The root crash screen — see RouteError for the logging and stale-deploy auto-recovery. */
export default function ErrorBoundary(props: { error: Error; reset: () => void }) {
  return <RouteError {...props} />;
}
