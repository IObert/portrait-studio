import { describe, expect, it } from "vitest";
import { ACTION_OPTION } from "@/lib/conversation/actions";
import { BACKGROUND_IDS } from "@/lib/events/schema";
import { STYLE_IDS } from "@/lib/prompts/styles";

describe("ACTION_OPTION (D-48)", () => {
  it("round-trips every style and background with a job id", () => {
    for (const id of STYLE_IDS) expect(ACTION_OPTION.parse(ACTION_OPTION.style(id, "Ab3_-xYz90QwErTy"))).toEqual({ kind: "style", jobId: "Ab3_-xYz90QwErTy", optionId: id });
    for (const id of BACKGROUND_IDS) expect(ACTION_OPTION.parse(ACTION_OPTION.background(id, "job_menu_01"))).toEqual({ kind: "background", jobId: "job_menu_01", optionId: id });
  });

  it("keeps ids inside WhatsApp's limit for list items (200 characters)", () => {
    expect(ACTION_OPTION.style("pixel-art", "x".repeat(64)).length).toBeLessThan(200);
  });

  it("does not read other payloads, including the short form from older menus", () => {
    for (const p of [undefined, "", "opt:anime", "ps:slide:yes:job_menu_01", "ps:opt:style:short:anime", "ps:opt:other:job_menu_01:anime", "ps:opt:style:job_menu_01:", "ps:opt:style:job_menu_01:Anime"])
      expect(ACTION_OPTION.parse(p)).toBeNull();
  });
});
