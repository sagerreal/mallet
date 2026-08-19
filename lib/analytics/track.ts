/**
 * lib/analytics/track.ts
 * Sending an event, and the two things that must ride with every one.
 *
 * `identify` is the person; `group` is their SHOP. Both matter and they are not the same question:
 * "how many people submitted hours" is a person answer, "how many shops ever sent a quote" is a
 * shop answer, and activation is only ever the second one. PostHog groups give the second for free
 * as long as every event carries the org — so that is done here rather than remembered per call.
 */
import { analyticsKey, posthog } from "./posthog";
import type { AnalyticsEvent, AnalyticsProps } from "./events";

/** The group type. One shop = one group, so per-shop funnels work without a property filter. */
export const ORG_GROUP = "org";

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (analyticsKey() === null) return;
  posthog.capture(event, props);
}

export interface AnalyticsIdentity {
  readonly userId: string;
  readonly orgId: string;
  readonly role: string;
}

/**
 * Ties events to a person and their shop.
 *
 * Sends NO email and NO name. PostHog would happily store both and they are not needed to answer
 * a single question worth asking — the id joins back to the database when somebody genuinely needs
 * to know who, and that lookup leaves an audit trail where it belongs.
 */
export function identify(who: AnalyticsIdentity): void {
  if (analyticsKey() === null) return;
  posthog.identify(who.userId, { role: who.role, org_id: who.orgId });
  posthog.group(ORG_GROUP, who.orgId);
}

/** On sign-out. Without it the next person on a shared van iPad inherits the last one's identity. */
export function resetAnalytics(): void {
  if (analyticsKey() === null) return;
  posthog.reset();
}
