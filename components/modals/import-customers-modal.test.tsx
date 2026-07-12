// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportCustomersModalContent } from "./import-customers-modal";

const mutateAsync = vi.fn();
const invalidate = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { customers: { list: { invalidate: invalidate } } } }),
    v1: { customers: { importCustomers: { useMutation: () => ({ mutateAsync, isPending: false }) } } },
  },
}));

// resetAllMocks clears call history AND queued *Once implementations, so a per-test
// mockResolvedValueOnce chain never leaks into the next test; then re-establish defaults.
beforeEach(() => {
  vi.resetAllMocks();
  mutateAsync.mockResolvedValue({ created: 1, deduped: 0, failed: 0, errors: [] });
  invalidate.mockResolvedValue(undefined);
});

function selectCsv(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], "c.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

// 555000 + zero-padded index = a valid 10-digit phone for every row.
function bigCsv(n: number): string {
  const body = Array.from({ length: n }, (_, i) => `Person ${i},555000${String(i).padStart(4, "0")}`).join("\n");
  return `Name,Phone\n${body}\n`;
}

describe("ImportCustomersModalContent", () => {
  it("parses an upload, shows a preview count, imports, and shows a summary", async () => {
    render(<ImportCustomersModalContent />);
    selectCsv(`First Name,Phone\nGary,(925) 555-0100\n`);

    await waitFor(() => expect(screen.getByText(/1 ready/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /import 1 customer/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/1 customer added/i)).toBeTruthy());
    expect(invalidate).toHaveBeenCalled();
  });

  it("imports >500 rows in ≤500-row chunks and aggregates the summary", async () => {
    mutateAsync
      .mockResolvedValueOnce({ created: 500, deduped: 0, failed: 0, errors: [] })
      .mockResolvedValueOnce({ created: 100, deduped: 0, failed: 0, errors: [] });

    render(<ImportCustomersModalContent />);
    selectCsv(bigCsv(600));
    await waitFor(() => expect(screen.getByText(/600 ready/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /import 600 customers/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync.mock.calls[0]![0].rows).toHaveLength(500);
    expect(mutateAsync.mock.calls[1]![0].rows).toHaveLength(100);
    await waitFor(() => expect(screen.getByText(/600 customers added/i)).toBeTruthy());
  });

  it("resumes from the failed chunk on retry (does not re-send committed rows)", async () => {
    mutateAsync
      .mockResolvedValueOnce({ created: 500, deduped: 0, failed: 0, errors: [] }) // chunk 1 ok
      .mockRejectedValueOnce(new Error("network"))                                // chunk 2 fails
      .mockResolvedValueOnce({ created: 100, deduped: 0, failed: 0, errors: [] }); // retry ok

    render(<ImportCustomersModalContent />);
    selectCsv(bigCsv(600));
    await waitFor(() => expect(screen.getByText(/600 ready/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /import 600 customers/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    // Back on the map phase after the mid-batch failure; the button now reads "Resume — N left".
    await waitFor(() => expect(screen.getByRole("button", { name: /resume — 100 left/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(3));

    // The retry sent ONLY the remaining 100 rows — the committed first chunk was not re-sent.
    expect(mutateAsync.mock.calls[2]![0].rows).toHaveLength(100);
    await waitFor(() => expect(screen.getByText(/600 customers added/i)).toBeTruthy());
  });

  it("re-sends from row 0 when the mapping changes after a partial failure (progress reset)", async () => {
    mutateAsync
      .mockResolvedValueOnce({ created: 500, deduped: 0, failed: 0, errors: [] }) // chunk 1 ok
      .mockRejectedValueOnce(new Error("network"))                                // chunk 2 fails
      .mockResolvedValue({ created: 0, deduped: 500, failed: 0, errors: [] });     // subsequent chunks

    render(<ImportCustomersModalContent />);
    selectCsv(bigCsv(600));
    await waitFor(() => expect(screen.getByText(/600 ready/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /import 600 customers/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /resume/i })).toBeTruthy());

    // Change the source tag — this alters built.rows, so the committed offset is now stale and must reset.
    fireEvent.change(screen.getByDisplayValue("Import"), { target: { value: "Migration" } });

    // Button returns to the full-import label (progress cleared), and importing re-sends chunk 0.
    await waitFor(() => expect(screen.getByRole("button", { name: /import 600 customers/i })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /import 600 customers/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(3));
    expect(mutateAsync.mock.calls[2]![0].rows).toHaveLength(500); // restarted at row 0, not resumed at 500
    expect(mutateAsync.mock.calls[2]![0].rows[0].source).toBe("Migration"); // new tag applied
  });
});
