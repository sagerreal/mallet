// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { CallbackNumberCard } from "./callback-number-card";

const mutate = vi.fn();
let me: { callbackNumber: string | null } | undefined = { callbackNumber: null };
let onError: ((e: unknown) => void) | undefined;

vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: {
      identity: { me: { useQuery: () => ({ data: me }) } },
      calls: {
        setCallbackNumber: {
          useMutation: (opts: { onError?: (e: unknown) => void }) => {
            onError = opts.onError;
            return { mutate, isPending: false };
          },
        },
      },
    },
    useUtils: () => ({ v1: { identity: { me: { invalidate: () => Promise.resolve() } } } }),
  },
}));

vi.mock("./fold-card", () => ({
  FoldCard: ({ title, summary, children }: { title: string; summary?: string; children: React.ReactNode }) => (
    <div>
      <h3>{title}</h3>
      {summary && <span data-testid="summary">{summary}</span>}
      <div>{children}</div>
    </div>
  ),
}));

describe("CallbackNumberCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    me = { callbackNumber: null };
  });

  it("reads 'Not set' when no number is on file, and offers no Clear", () => {
    render(<CallbackNumberCard />);
    expect(screen.getByTestId("summary").textContent).toBe("Not set");
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  it("shows a stored number the way a person reads it", () => {
    me = { callbackNumber: "+16693413343" };
    render(<CallbackNumberCard />);
    expect(screen.getByTestId("summary").textContent).toBe("(669) 341-3343");
    expect(screen.getByDisplayValue("(669) 341-3343")).toBeTruthy();
  });

  it("saves a typed number", () => {
    render(<CallbackNumberCard />);
    fireEvent.change(screen.getByLabelText(/callback number/i), { target: { value: "(781) 385-0591" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mutate).toHaveBeenCalledWith({ callbackNumber: "(781) 385-0591" });
  });

  it("refuses an unparseable number without calling the server", () => {
    render(<CallbackNumberCard />);
    fireEvent.change(screen.getByLabelText(/callback number/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/doesn't look right/i)).toBeTruthy();
  });

  it("clears the number explicitly", () => {
    me = { callbackNumber: "+16693413343" };
    render(<CallbackNumberCard />);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(mutate).toHaveBeenCalledWith({ callbackNumber: null });
  });

  it("emptying the box and saving is a clear, not an error", () => {
    me = { callbackNumber: "+16693413343" };
    render(<CallbackNumberCard />);
    fireEvent.change(screen.getByLabelText(/callback number/i), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(mutate).toHaveBeenCalledWith({ callbackNumber: null });
  });

  it("surfaces a server refusal as plain copy, never raw transport text", () => {
    render(<CallbackNumberCard />);
    // An INTERNAL_SERVER_ERROR carries a Drizzle "Failed query: select …" message. The card must
    // show the fixed sentence instead — that raw SQL is exactly what leaked into the call bar.
    act(() => {
      onError?.({
        data: { code: "INTERNAL_SERVER_ERROR" },
        message: 'Failed query: select "callback_number" from "users"',
      });
    });
    expect(screen.queryByText(/Failed query/)).toBeNull();
    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
  });
});
