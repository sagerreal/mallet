"use client";

/**
 * lib/analytics/analytics-provider.tsx
 * Starts analytics, sends pageviews, and keeps the identity in step with who is signed in.
 *
 * PAGEVIEWS BY HAND. PostHog's automatic pageview fires on script load, which in the App Router is
 * before the route has resolved — every navigation would be attributed to whatever URL happened to
 * be showing. usePathname fires after, so it names the page the person actually landed on.
 *
 * The QUERY STRING IS DROPPED. Mallet puts job, customer and invoice ids in it, and a URL is the
 * one property nobody thinks of as personal data right up until it is a join key back to a home
 * address. Only the path is sent.
 */

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { startAnalytics, posthog, analyticsKey } from "./posthog";

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    startAnalytics();
  }, []);

  useEffect(() => {
    if (analyticsKey() === null) return;
    posthog.capture("$pageview", { $pathname: pathname });
  }, [pathname]);

  return <>{children}</>;
}
