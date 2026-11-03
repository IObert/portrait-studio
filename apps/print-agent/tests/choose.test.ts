import { describe, expect, it } from "vitest";
import { describeChoices, formatMenu, listPrinters, parseCupsPrinters, parseSelection } from "../src/choose.js";

const LPSTAT_P = `printer Dai_Nippon_Printing_DP_DS620 is idle.  enabled since Mon Nov  3 10:00:00 2026
printer MITSUBISHI_CP60D70D707D disabled since Mon Nov  3 10:00:00 2026 -
\tPaused
printer HP_OfficeJet now printing HP_OfficeJet-7.  enabled since Mon Nov  3 10:00:00 2026
`;

describe("choosing a printer at start-up", () => {
  it("lists the CUPS queues from lpstat -p", () => {
    expect(parseCupsPrinters(LPSTAT_P)).toEqual(["Dai_Nippon_Printing_DP_DS620", "MITSUBISHI_CP60D70D707D", "HP_OfficeJet"]);
    expect(parseCupsPrinters("")).toEqual([]);
  });
  it("labels the supported models and numbers the menu after the simulator", () => {
    const menu = formatMenu(describeChoices(parseCupsPrinters(LPSTAT_P)));
    expect(menu).toContain("1) Simulator");
    expect(menu).toContain("2) Dai_Nippon_Printing_DP_DS620 (DNP DS620)");
    expect(menu).toContain("3) MITSUBISHI_CP60D70D707D (Mitsubishi CP-D70DW)");
    expect(menu).toContain("4) HP_OfficeJet\n".trim());
    expect(menu).not.toContain("HP_OfficeJet (");
  });
  it("reads the answer: empty and 1 are the simulator, 2.. the printers, the rest is refused", () => {
    expect(parseSelection("", 2)).toEqual({ kind: "simulate" });
    expect(parseSelection(" 1 ", 2)).toEqual({ kind: "simulate" });
    expect(parseSelection("2", 2)).toEqual({ kind: "printer", index: 0 });
    expect(parseSelection("3", 2)).toEqual({ kind: "printer", index: 1 });
    for (const bad of ["0", "4", "-1", "x", "1.5", "2 3"]) expect(parseSelection(bad, 2), bad).toBeNull();
  });
  it("finds printers through lpstat on CUPS and PowerShell on Windows, and none when the tool fails", async () => {
    const ok = (stdout: string) => ({ stdout, stderr: "", code: 0 });
    expect(await listPrinters(false, { run: async () => ok(LPSTAT_P) })).toHaveLength(3);
    expect(await listPrinters(false, { run: async () => ({ stdout: "", stderr: "no scheduler", code: 1 }) })).toEqual([]);
    expect(await listPrinters(true, { ps: async () => ok('["DP-DS620","Microsoft Print to PDF"]') })).toEqual(["DP-DS620", "Microsoft Print to PDF"]);
    expect(await listPrinters(true, { ps: async () => ok("not json") })).toEqual([]);
  });
});
