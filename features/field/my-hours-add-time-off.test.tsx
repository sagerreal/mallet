// @vitest-environment jsdom
/**
 * features/field/my-hours-add-time-off.test.tsx
 *
 * The form that records paid absence. What it must never do is the reason it exists as its own
 * surface: emit punch times. A sick day carrying 08:00–16:00 is eight hours of WORKED time to the
 * overlap gate and the overtime threshold, so someone who took Tuesday off and worked thirty-six
 * real hours would be paid overtime.
 *
 * The other load-bearing property is that "Full day" is the SHOP's configured day, not eight
 * hours — a four-tens crew row means a full day off is ten.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const standardDayQuery = vi.fn();
vi.mock("@/lib/trpc/client", () => ({
  api: {
    v1: { field: { standardDay: { useQuery: () => standardDayQuery() } } },
  },
}));

const { AddTimeOffForm } = await import("./my-hours-add-time-off");

const TODAY = "2026-08-19";

const answered = (minutes: number | null) => ({ data: { minutes }, isSuccess: true });

const renderForm = (onAdd = vi.fn()) => {
  render(
    <AddTimeOffForm
      today={TODAY}
      techUserId="tech-1"
      saving={false}
      error={null}
      onAdd={onAdd}
      onCancel={vi.fn()}
    />,
  );
  return onAdd;
};

const submit = (): void => {
  fireEvent.click(screen.getByRole("button", { name: /add this time off/i }));
};

beforeEach(() => {
  standardDayQuery.mockReset();
  standardDayQuery.mockReturnValue(answered(8 * 60));
});

describe("AddTimeOffForm", () => {
  it("offers no Start or End at all — the row shape forbids them", () => {
    renderForm();
    expect(screen.queryByLabelText(/^start$/i)).toBeNull();
    expect(screen.queryByLabelText(/^end$/i)).toBeNull();
  });

  it("writes a full day from the shop's own standard, and never punch times", () => {
    const onAdd = renderForm();
    submit();

    expect(onAdd).toHaveBeenCalledTimes(1);
    const input = onAdd.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({ techUserId: "tech-1", workDate: TODAY, kind: "pto", minutes: 480 });
    expect(input, "a time-off row carrying times is refused by the domain").not.toHaveProperty("startTime");
    expect(input).not.toHaveProperty("endTime");
  });

  // A four-tens shop. Hardcoding 480 would short this technician two hours per day taken.
  it("takes a ten-hour day from a ten-hour crew row", () => {
    standardDayQuery.mockReturnValue(answered(600));
    const onAdd = renderForm();
    submit();
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ minutes: 600 });
  });

  it("labels Full day with the length, so the number is never a mystery", () => {
    standardDayQuery.mockReturnValue(answered(450));
    renderForm();
    expect(screen.getByRole("button", { name: /full day \(7h 30m\)/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /half day \(3h 45m\)/i })).toBeTruthy();
  });

  it("halves that same standard for a half day", () => {
    const onAdd = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /half day/i }));
    submit();
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ minutes: 240 });
  });

  it("records the kind the technician picked", () => {
    const onAdd = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /^sick$/i }));
    submit();
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ kind: "sick" });
  });

  it("converts typed hours to minutes", () => {
    const onAdd = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /^hours$/i }));
    fireEvent.change(screen.getByLabelText(/^hours$/i), { target: { value: "7.5" } });
    submit();
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ minutes: 450 });
  });

  it("refuses a full day on a day the shop has off, and says where to go instead", () => {
    standardDayQuery.mockReturnValue(answered(null));
    const onAdd = renderForm();

    expect(screen.getByText(/day off/i)).toBeTruthy();
    submit();
    expect(onAdd, "saving here would write a row worth no time").not.toHaveBeenCalled();
  });

  it("still records a part day on a day off, once hours are typed", () => {
    standardDayQuery.mockReturnValue(answered(null));
    const onAdd = renderForm();
    fireEvent.click(screen.getByRole("button", { name: /^hours$/i }));
    fireEvent.change(screen.getByLabelText(/^hours$/i), { target: { value: "4" } });
    submit();
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ minutes: 240 });
  });

  // An unresolved query is not an answer. Flashing "this is a day off" at someone whose read has
  // not landed teaches them the screen is wrong.
  it("says nothing about a day off while the shop's answer is still in flight", () => {
    standardDayQuery.mockReturnValue({ data: undefined, isSuccess: false });
    renderForm();
    expect(screen.queryByText(/day off/i)).toBeNull();
  });

  it("will not save while the shop's answer is still in flight", () => {
    standardDayQuery.mockReturnValue({ data: undefined, isSuccess: false });
    const onAdd = renderForm();
    submit();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("surfaces the server's refusal rather than swallowing it", () => {
    standardDayQuery.mockReturnValue(answered(480));
    render(
      <AddTimeOffForm
        today={TODAY}
        techUserId="tech-1"
        saving={false}
        error="that week is already approved"
        onAdd={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/already approved/i)).toBeTruthy();
  });
});
