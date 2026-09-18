// @vitest-environment jsdom
/**
 * features/a2p/sms-setup-banner.test.tsx
 * The one place that EXPLAINS and the one place that LINKS. Everything else about texting being
 * off is a single clause beside the control it blocks.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { A2pStatusView } from "@mallet/a2p";
import { SmsSetupBanner } from "./sms-setup-banner";
import { SMS_PENDING_DETAIL, SMS_SETTINGS_HREF, SMS_SETUP_LABEL } from "./sms-copy";

const state = { a2pStatus: null as A2pStatusView | null };
vi.mock("@/lib/store/app-store", () => ({
  useAppStore: (sel: (s: typeof state) => unknown) => sel(state),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const view = (over: Partial<A2pStatusView>): A2pStatusView => ({
  status: "brand_pending", canText: false, needsInput: false, failureReason: null, ...over,
});

describe("SmsSetupBanner", () => {
  it("says nothing at all once texting works", () => {
    state.a2pStatus = view({ status: "active", canText: true });
    const { container } = render(<SmsSetupBanner />);
    expect(container.innerHTML).toBe("");
  });

  /**
   * The hydration-flash law, applied to a claim. A banner that appears for the length of a fetch
   * and then vanishes accuses a fully registered shop of nothing in particular, loudly.
   */
  it("stays silent while the hydrator is still in flight", () => {
    state.a2pStatus = null;
    const { container } = render(<SmsSetupBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("explains and links when the shop has not registered", () => {
    state.a2pStatus = view({ status: "not_started", needsInput: true });
    render(<SmsSetupBanner />);
    // Names what still works. Reminders and receipts DO send — on Mallet's shared line — so the
    // thing actually missing is the back-and-forth, and the copy has to say that and not the
    // reverse (it briefly claimed those went by email, which stopped being true the day the shared
    // line landed).
    expect(screen.getByText(/Reminders and receipts still send/)).toBeTruthy();
    expect(screen.getByText(/can't message customers back and forth/)).toBeTruthy();
    const link = screen.getByRole("link", { name: SMS_SETUP_LABEL });
    expect(link.getAttribute("href")).toBe(SMS_SETTINGS_HREF);
  });

  it("offers NO link while a carrier is reviewing — there is no step to take", () => {
    state.a2pStatus = view({ status: "campaign_pending" });
    render(<SmsSetupBanner />);
    expect(screen.getByText(SMS_PENDING_DETAIL)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("prints the carrier's own rejection and offers the way back", () => {
    state.a2pStatus = view({ status: "failed", needsInput: true, failureReason: "EIN did not match" });
    render(<SmsSetupBanner />);
    expect(screen.getByText("EIN did not match")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Fix registration" })).toBeTruthy();
  });

  it("is a region a screen reader can find, not an anonymous strip", () => {
    state.a2pStatus = view({ status: "not_started", needsInput: true });
    render(<SmsSetupBanner />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
