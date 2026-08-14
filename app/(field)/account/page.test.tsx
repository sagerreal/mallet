// @vitest-environment jsdom
/**
 * app/(field)/account/page.test.tsx
 *
 * Two pages are titled "More" — this one (the field tab bar's overflow) and /more (the office
 * one) — and each kept its own hand-written link list. They drifted: an owner who reached this
 * page from the field shell could not get to Front Desk or Pricebook at all, and /dashboard was
 * labelled "Home" here and "Office" there. Both now render the SAME module, so a destination
 * added to one cannot go missing from the other.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let role = "owner";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/features/identity/hooks", () => ({
  useMe: () => ({ data: { role, orgName: "Rivera Plumbing", email: "owen@rivera.test" } }),
}));
vi.mock("@/components/shell/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Sign out</button>,
}));
vi.mock("@/features/settings/callback-number-form", () => ({
  CallbackNumberForm: () => <div data-testid="callback-form" />,
}));

import FieldAccountPage from "./page";
import { OFFICE_LINKS, FIELD_LINKS } from "@/components/shell/more-links";

const hrefs = () =>
  Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));

describe("Field More page", () => {
  beforeEach(() => {
    role = "owner";
  });

  it("reaches every office destination the office More page does", () => {
    render(<FieldAccountPage />);
    for (const link of OFFICE_LINKS) expect(hrefs()).toContain(link.href);
    // The two that were missing outright.
    expect(screen.getByText("Front Desk")).toBeTruthy();
    expect(screen.getByText("Pricebook")).toBeTruthy();
  });

  it("calls /dashboard what the sidebar calls it, not 'Home'", () => {
    render(<FieldAccountPage />);
    const dashboard = Array.from(document.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/dashboard",
    );
    expect(dashboard!.textContent).toContain("Office");
    expect(screen.queryByText("Home")).toBeNull();
  });

  it("shows a tech the field surfaces and no office section", () => {
    role = "tech";
    render(<FieldAccountPage />);
    for (const link of FIELD_LINKS) expect(hrefs()).toContain(link.href);
    for (const link of OFFICE_LINKS) expect(hrefs()).not.toContain(link.href);
  });

  it("keeps the callback number — the one setting a technician owns", () => {
    role = "tech";
    render(<FieldAccountPage />);
    expect(screen.getByTestId("callback-form")).toBeTruthy();
  });
});
