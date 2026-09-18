// @vitest-environment jsdom
/**
 * Staging a file on a form that has nothing to attach it to yet.
 *
 * WHY VALIDATION HAPPENS HERE and not only in the uploader: the uploaders check extension and
 * size too — they are the boundary — but by then the customer or job has been CREATED and the
 * office is watching a modal close. Refusing the file the moment it is picked is the difference
 * between "that file won't work" and "your customer saved but their photo vanished".
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useStagedAttachment, StagedAttachButton, StagedAttachStatus, attachErrorMessage } from "./staged-attachment";
import { UnsupportedFileError, FileTooLargeError, MAX_FILE_BYTES } from "@/lib/store/upload-job-file";

/** A File of a given size without allocating the bytes — jsdom honours the size override. */
function fakeFile(name: string, bytes = 10): File {
  const f = new File(["x"], name, { type: "application/octet-stream" });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

const seen: { file: File | null; name: string | null; error: string | null }[] = [];

function Harness() {
  const staged = useStagedAttachment();
  seen.push({ file: staged.file, name: staged.name, error: staged.error });
  return (
    <>
      <StagedAttachButton staged={staged} />
      <StagedAttachStatus staged={staged} />
    </>
  );
}

const last = () => seen[seen.length - 1]!;

const pick = (file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
};

describe("staging a file", () => {
  /**
   * The NAME is a chip below the row, not text inside the button — putting it in the button made
   * it change width the moment a file was picked, and left nowhere to un-attach without replacing.
   * The button stays a fixed-size paperclip and says what it does through its accessible label.
   */
  it("keeps an allowed file, naming it in a chip and not in the button", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("permit.pdf"));

    expect(last().name).toBe("permit.pdf");
    expect(last().error).toBeNull();
    expect(document.querySelector(".attachchip-n")?.textContent).toBe("permit.pdf");
    expect(screen.getByRole("button", { name: /Replace the attached file, permit\.pdf/ })).toBeTruthy();
  });

  it("offers a way to drop the staged file without replacing it", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("permit.pdf"));
    fireEvent.click(screen.getByRole("button", { name: "Remove permit.pdf" }));
    expect(last().file).toBeNull();
    expect(document.querySelector(".attachchip")).toBeNull();
  });

  /** Nothing staged and nothing refused: the form is exactly the form it was before. */
  it("renders no chip and no error line when there is nothing to say", () => {
    seen.length = 0;
    render(<Harness />);
    expect(document.querySelector(".attachchip")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses an extension the server would reject, naming it", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("payload.svg"));
    expect(last().file).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("Can't attach a .svg file.");
  });

  it("refuses a file over the size cap BEFORE anything is created", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("huge.pdf", MAX_FILE_BYTES + 1));
    expect(last().file).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("That file is over 10 MB.");
  });

  it("accepts a file exactly at the cap", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("exact.pdf", MAX_FILE_BYTES));
    expect(last().name).toBe("exact.pdf");
  });

  /** A refusal must not leave the previous good file staged — that would upload the wrong one. */
  it("drops the staged file when a later pick is refused", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("permit.pdf"));
    expect(last().name).toBe("permit.pdf");
    pick(fakeFile("payload.svg"));
    expect(last().file).toBeNull();
  });

  it("clears the refusal once an allowed file is picked", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("payload.svg"));
    expect(screen.queryByRole("alert")).toBeTruthy();
    pick(fakeFile("permit.pdf"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /**
   * The input's value is reset on every pick, so choosing the SAME filename again still fires a
   * change event. Without it a refused pick could not be retried after the file was fixed on disk.
   */
  it("resets the input so the same filename can be picked again", () => {
    seen.length = 0;
    render(<Harness />);
    pick(fakeFile("permit.pdf"));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("the control refuses presses while the form is in flight", () => {
    function Busy() {
      const staged = useStagedAttachment();
      return <StagedAttachButton staged={staged} busy />;
    }
    render(<Busy />);
    expect(screen.getByRole("button", { name: "Attaching a file…" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("attachErrorMessage", () => {
  it("names the extension that was refused", () => {
    expect(attachErrorMessage(new UnsupportedFileError("svg"))).toBe("Can't attach a .svg file.");
  });

  it("names the size rule", () => {
    expect(attachErrorMessage(new FileTooLargeError())).toBe("That file is over 10 MB.");
  });

  /** Anything else is a connection problem as far as the office is concerned. */
  it("falls back without pretending to know the cause", () => {
    expect(attachErrorMessage(new Error("ECONNRESET"))).toBe("That didn't upload — try again.");
    expect(attachErrorMessage(undefined)).toBe("That didn't upload — try again.");
  });
});
