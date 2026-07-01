// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./data-table";

const rows = [
  { id: "1", name: "Karen", due: "$120.00" },
  { id: "2", name: "Bob", due: "$0.00" },
];
const columns = [
  { key: "name", header: "Name", render: (r: (typeof rows)[0]) => r.name },
  { key: "due", header: "Due", render: (r: (typeof rows)[0]) => r.due, hideOnMobile: true },
];

describe("DataTable", () => {
  it("renders BOTH a desktop table and mobile cards for the same rows (CSS chooses)", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty="none" />);
    // Table region (hidden below md via classes) + card region both exist in the DOM.
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getAllByText("Karen").length).toBe(2); // once in table, once in card list
  });

  it("renders the empty state when there are no rows", () => {
    render(<DataTable columns={columns} rows={[]} rowKey={(r: { id: string }) => r.id} empty="Nothing yet" />);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
