// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { BusinessIdentityCard } from "./business-identity-card";

const mutate = vi.fn();
const invalidate = vi.fn();

interface SettingsData {
  business: { address: string | null; phone: string | null; email: string | null; license: string | null };
  config: { serviceOriginAddress: string | null };
}

let queryState: { data: SettingsData | undefined; isFetched: boolean } = {
  data: undefined,
  isFetched: false,
};
let isPending = false;

vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { settings: { get: { invalidate } } } }),
    v1: {
      settings: {
        get: { useQuery: () => queryState },
        updateBusiness: { useMutation: () => ({ mutate, isPending }) },
      },
    },
  },
}));

vi.mock("./fold-card", () => ({
  FoldCard: ({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) => (
    <div data-testid="foldcard">
      <div className="fhead">
        <h3>{title}</h3>
        {summary && <span className="fsum">{summary}</span>}
      </div>
      <div className="fbody">{children}</div>
    </div>
  ),
}));

const loaded = (over: Partial<SettingsData["business"]> = {}, origin: string | null = null): void => {
  queryState = {
    isFetched: true,
    data: {
      business: { address: null, phone: null, email: null, license: null, ...over },
      config: { serviceOriginAddress: origin },
    },
  };
};

describe("BusinessIdentityCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isPending = false;
    queryState = { data: undefined, isFetched: false };
  });

  it("waits for the real values before showing editable fields", () => {
    // Empty inputs that look editable while the query is in flight invite a Save that writes
    // four blanks over four real values.
    render(<BusinessIdentityCard />);
    expect(screen.getByText("Loading…", { selector: "p" })).toBeTruthy();
    expect(screen.queryByLabelText(/business address/i)).toBeNull();
  });

  it("renders the stored business details", () => {
    loaded({
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: "(925) 555-0100",
      email: "billing@rivera.com",
      license: "C36-1029384",
    });
    render(<BusinessIdentityCard />);
    expect(screen.getByDisplayValue("200 Ray St, Pleasanton, CA 94566")).toBeTruthy();
    expect(screen.getByDisplayValue("(925) 555-0100")).toBeTruthy();
    expect(screen.getByDisplayValue("billing@rivera.com")).toBeTruthy();
    expect(screen.getByDisplayValue("C36-1029384")).toBeTruthy();
  });

  it("labels every control in plain business language, associated with its input", () => {
    // getByLabelText only matches when label and control are actually wired (the a11y floor).
    loaded();
    render(<BusinessIdentityCard />);
    expect(screen.getByLabelText("Business address")).toBeTruthy();
    expect(screen.getByLabelText("Phone customers should call")).toBeTruthy();
    expect(screen.getByLabelText("Email for billing questions")).toBeTruthy();
    expect(screen.getByLabelText("License number")).toBeTruthy();
  });

  it("summarises with the address when set", () => {
    loaded({ address: "200 Ray St, Pleasanton, CA 94566" });
    render(<BusinessIdentityCard />);
    expect(screen.getByText("200 Ray St, Pleasanton, CA 94566", { selector: ".fsum" })).toBeTruthy();
  });

  it("summarises 'Not set' when the shop has filled nothing in", () => {
    loaded();
    render(<BusinessIdentityCard />);
    expect(screen.getByText("Not set", { selector: ".fsum" })).toBeTruthy();
  });

  it("saves the edited fields", () => {
    loaded();
    render(<BusinessIdentityCard />);
    fireEvent.change(screen.getByLabelText("Business address"), {
      target: { value: "200 Ray St, Pleasanton, CA 94566" },
    });
    fireEvent.change(screen.getByLabelText("License number"), { target: { value: "C36-1029384" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      address: "200 Ray St, Pleasanton, CA 94566",
      phone: null,
      email: null,
      license: "C36-1029384",
    });
  });

  it("clears a field to null, not to an empty string", () => {
    // "" would store a blank the document then has to treat as absent all over again.
    loaded({ phone: "(925) 555-0100" });
    render(<BusinessIdentityCard />);
    fireEvent.change(screen.getByLabelText("Phone customers should call"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ phone: null });
  });

  it("saves a license number of any shape — no format validation", () => {
    loaded();
    render(<BusinessIdentityCard />);
    fireEvent.change(screen.getByLabelText("License number"), { target: { value: "MP 1234 / RMP 5678" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ license: "MP 1234 / RMP 5678" });
  });

  it("hints the service-area origin as a placeholder without copying it into the value", () => {
    // They are different facts: the origin is where drive time is measured from, often a yard.
    // A silent copy would make an invoice edit look like a routing change.
    loaded({ address: null }, "9 Yard Rd, Livermore, CA");
    render(<BusinessIdentityCard />);
    const input = screen.getByLabelText("Business address") as HTMLInputElement;
    expect(input.placeholder).toBe("9 Yard Rd, Livermore, CA");
    expect(input.value).toBe("");
  });

  it("falls back to a generic placeholder when no origin is set", () => {
    loaded();
    render(<BusinessIdentityCard />);
    const input = screen.getByLabelText("Business address") as HTMLInputElement;
    expect(input.placeholder).toBe("Street, city, state ZIP");
  });

  it("does not overwrite an in-progress edit when the query re-resolves", () => {
    loaded({ address: "200 Ray St" });
    const { rerender } = render(<BusinessIdentityCard />);
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "1 Market St" } });

    loaded({ address: "200 Ray St" });
    act(() => {
      rerender(<BusinessIdentityCard />);
    });

    expect(screen.getByDisplayValue("1 Market St")).toBeTruthy();
  });

  it("surfaces a save failure instead of failing silently", () => {
    loaded();
    render(<BusinessIdentityCard />);
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "200 Ray St" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    const onError = mutate.mock.calls[0]?.[1]?.onError as (e: unknown) => void;
    act(() => {
      onError({ message: "boom", data: {} });
    });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't save your business details");
  });

  it("flashes Saved and refreshes settings after a successful save", () => {
    loaded();
    render(<BusinessIdentityCard />);
    fireEvent.change(screen.getByLabelText("Business address"), { target: { value: "200 Ray St" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    const onSuccess = mutate.mock.calls[0]?.[1]?.onSuccess as () => void;
    act(() => {
      onSuccess();
    });
    expect(invalidate).toHaveBeenCalled();
    expect(screen.getByText("Saved ✓")).toBeTruthy();
  });

  it("disables Save while the write is in flight", () => {
    loaded();
    isPending = true;
    render(<BusinessIdentityCard />);
    expect(screen.getByRole("button", { name: /saving/i }).hasAttribute("disabled")).toBe(true);
  });
});
