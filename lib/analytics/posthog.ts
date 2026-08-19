/**
 * lib/analytics/posthog.ts
 * The one place PostHog is configured, and the one place it is allowed to be absent.
 *
 * NO KEY = NO-OP, everywhere. A local checkout, a preview build and a test run all have no key,
 * and none of them should reach the real project — an "is it configured" branch at every call
 * site is how one of them eventually does, so the branch lives here once.
 *
 * The defaults below are chosen against this app's data, not from the quickstart:
 *
 *  · autocapture OFF. It records the text inside whatever was clicked, and nearly everything
 *    clickable in Mallet contains a customer's name, address, phone number or invoice total.
 *  · session replay OFF. It films the screen. That screen is somebody's home address and what
 *    they paid to have their boiler fixed.
 *  · identified_only profiles. Anonymous traffic gets events but no stored person, so a shop's
 *    logged-out marketing visit does not become a billable profile.
 *  · pageviews sent BY HAND (see the provider). Automatic ones fire before the route is known in
 *    an App Router app and land on the wrong URL.
 */
import posthog from "posthog-js";

const DEFAULT_HOST = "https://us.i.posthog.com";

/** Where the browser sends events. Same-origin by default so ad blockers do not eat them. */
export const INGEST_PATH = "/ingest";

export function analyticsKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  return key !== undefined && key !== "" ? key : null;
}

export function analyticsHost(): string {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  return host !== undefined && host !== "" ? host : DEFAULT_HOST;
}

let started = false;

/** Idempotent: React strict mode mounts effects twice and a second init would double every event. */
export function startAnalytics(): void {
  const key = analyticsKey();
  if (key === null || started) return;
  started = true;
  posthog.init(key, {
    // Through our own origin (next.config rewrites /ingest → PostHog). A third of this audience
    // runs a blocker that drops requests to posthog.com by hostname.
    api_host: INGEST_PATH,
    ui_host: analyticsHost(),
    autocapture: false,
    disable_session_recording: true,
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: "identified_only",
    // The default sends the full URL including query. Job and customer ids ride in those, and an
    // id in an analytics tool is a join key back to a real person's address.
    mask_personal_data_properties: true,
  });
}

export { posthog };
