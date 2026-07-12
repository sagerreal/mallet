// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ImportCustomersModalContent } from "./import-customers-modal";

const mutateAsync = vi.fn().mockResolvedValue({ created: 1, deduped: 0, failed: 0, errors: [] });
const invalidate = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    useUtils: () => ({ v1: { customers: { list: { invalidate: invalidate } } } }),
    v1: { customers: { importCustomers: { useMutation: () => ({ mutateAsync, isPending: false }) } } },
  },
}));

function selectCsv(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], "c.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("ImportCustomersModalContent", () => {
  it("parses an upload, shows a preview count, imports, and shows a summary", async () => {
    render(<ImportCustomersModalContent />);
    selectCsv(`First Name,Phone\nGary,(925) 555-0100\n`);

    // moves to the map/preview phase and reports 1 ready row
    await waitFor(() => expect(screen.getByText(/1 ready/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /import 1 customer/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/1 added/i)).toBeTruthy());
    expect(invalidate).toHaveBeenCalled();
  });
});
