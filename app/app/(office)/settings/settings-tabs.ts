/**
 * app/(office)/settings/settings-tabs.ts
 * Which Settings tab a URL means — including every URL that outlived the tab it was written for.
 *
 * THIS IS A CONTRACT WITH PRODUCTION, not a convenience. Two of these links are generated
 * SERVER-SIDE and are in flight right now for any shop mid-onboarding:
 *
 *   /settings?tab=payments&connect=return   Stripe Connect's return URL (settings-router.ts)
 *   /settings?tab=quickbooks&qbo=…          the QuickBooks OAuth callback (app/api/qbo/callback)
 *
 * A shop that started connecting its bank account before a deploy comes back after it. If those
 * names ever stop resolving, the shop lands on the wrong tab with no idea whether the connection
 * worked — so the aliases below are permanent, and pulled out here so they can be read and tested
 * without rendering a page full of live queries.
 */

export const SET_TABS = ["company", "team", "integrations", "you"] as const;
export type SetTab = (typeof SET_TABS)[number];

export const DEFAULT_SET_TAB: SetTab = "company";

/** Old tab names → where that content lives now. */
const TAB_ALIASES: Record<string, SetTab> = {
  // "Workspace" named nothing an owner would go looking for, and "Channels" ended up holding a
  // single card that was not a channel. Both fold into Company — who this shop is and how it runs.
  workspace: "company",
  channels: "company",
  sources: "company",
  fields: "company",
  archive: "company",
  // The two server-generated return URLs. See the header.
  payments: "integrations",
  quickbooks: "integrations",
};

/** Tabs that became their own PAGE — the old link follows the content rather than dead-ending. */
const TAB_REDIRECTS: Record<string, string> = {
  pricing: "/pricebook",
  booking: "/frontdesk",
  frontdesk: "/frontdesk",
};

export interface TabResolution {
  /** Navigate here instead — the content moved off Settings entirely. */
  readonly redirectTo?: string;
  /** The tab to open. Undefined means "no ?tab= given" — leave whatever is showing. */
  readonly tab?: SetTab;
}

/**
 * Resolve a `?tab=` value.
 *
 * An UNKNOWN name resolves to nothing rather than to Workspace, so a typo or a link from a future
 * version leaves the page on its default instead of silently claiming that is what was asked for.
 */
export function resolveSettingsTab(raw: string | null): TabResolution {
  if (!raw) return {};
  const redirectTo = TAB_REDIRECTS[raw];
  if (redirectTo) return { redirectTo };
  if ((SET_TABS as readonly string[]).includes(raw)) return { tab: raw as SetTab };
  const alias = TAB_ALIASES[raw];
  return alias ? { tab: alias } : {};
}
