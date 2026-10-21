import { describe, expect, it } from "vitest";
import { csvCell, csvDataRows } from "@/lib/leads/csv";

const csv = (rows: string[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
const HEADER = ["first_name", "email"];

describe("csvDataRows", () => {
  it("counts data rows without the header", () => {
    expect(csvDataRows(csv([HEADER]))).toBe(0);
    expect(csvDataRows(csv([HEADER, ["Ana", "a@x.com"], ["Bo", "b@x.com"]]))).toBe(2);
  });

  it("a cell with a line break is still one row", () => {
    expect(csvDataRows(csv([HEADER, ["Ana\r\nSouza", "a@x.com"], ["Bo", "b@x.com"]]))).toBe(2);
    expect(csvDataRows(csv([HEADER, ["Ana\nSouza", "a@x.com"]]))).toBe(1);
  });

  it("quotes inside a cell (escaped as \"\") do not confuse the count", () => {
    expect(csvDataRows(csv([HEADER, ['Ana "Nan"\r\nSouza', "a@x.com"], ['"', "b@x.com"], ["Cy", "c@x.com"]]))).toBe(3);
  });

  it("an empty export is zero, not negative", () => {
    expect(csvDataRows("")).toBe(0);
  });
});
