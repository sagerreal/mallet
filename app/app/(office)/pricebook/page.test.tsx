// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

import PricebookRedirect from "./page";

describe("/pricebook — redirects into the Office page", () => {
  beforeEach(() => vi.clearAllMocks());
  it("replaces to /dashboard?tab=pricebook so old links keep working", () => {
    render(<PricebookRedirect />);
    expect(replace).toHaveBeenCalledWith("/dashboard?tab=pricebook");
  });
});
