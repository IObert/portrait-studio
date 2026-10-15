import { describe, expect, it } from "vitest";
import { kingsBackgrounds } from "@/lib/events/kings";
import { LA_KINGS } from "@/lib/brands/la-kings";
import { defaultConfig, EventConfigInputSchema } from "@/lib/events/schema";
import { BRAND_CORE } from "@/lib/prompts/brand";
import { buildPrompt } from "@/lib/prompts/build";
import { PRESERVE } from "@/lib/prompts/defaults";
import { STYLE_IDS } from "@/lib/prompts/styles";

const one = { subjects: 1, pet: null };

describe("LA Kings prompt (D-36)", () => {
  it("replaces the preserve line in every style, so the jersey can replace the person's own top", () => {
    for (const style of STYLE_IDS) {
      const p = buildPrompt(style, "ice-rink", one, undefined, LA_KINGS);
      expect(p, style).not.toContain(PRESERVE);
      expect(p, style).toContain("Preserve accurately: skin tone, eye color, hair color and style, facial hair, glasses, facial structure.");
      expect(p, style).toContain(`FINAL STYLE LOCK: Render the entire output in this exact art style: ${BRAND_CORE[style]}`);
    }
  });

  it("names the reference images in the order they are sent, and puts each block in §E order", () => {
    const p = buildPrompt("pop-art", "ice-rink", one, undefined, LA_KINGS);
    expect(p).toContain("The input images named brand_ref_0.png, brand_ref_1.png, brand_ref_2.png show the outfit visually.");
    expect(p).toContain("The input image named bg_ref_0.png shows the background visually. The subject stands on the ice inside Crypto.com Arena");
    const order = ["Clothing: Dress the subject", "Logos and text:", LA_KINGS.wardrobe, "REMINDER: The art style", "Background: Match", "FINAL STYLE LOCK", "FINAL REMINDER"].map((t) => p.indexOf(t));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("groups and pets get the §E4 wording", () => {
    const group = buildPrompt("anime", "crypto-arena", { subjects: 3, pet: null }, undefined, LA_KINGS);
    expect(group).toContain("Clothing: There are 3 people — dress EVERY person in the outfit/gear from the brand reference photos.");
    expect(group).toContain("Preserve accurately for every subject: skin tone");
    expect(buildPrompt("sketch", "ice-rink", { subjects: 1, pet: "dog" }, undefined, LA_KINGS)).toContain("Include the dog naturally in the image.");
  });

  it("a non-Kings background still works with the jersey", () => {
    const p = buildPrompt("cartoon", "gradient", one, undefined, LA_KINGS);
    expect(p).toContain("Background: Clean soft gradient");
    expect(p).not.toContain("bg_ref_0.png");
  });

  it("without the promotion the prompt is unchanged and the Kings scenes cannot be built", () => {
    expect(buildPrompt("cartoon", "gradient", one)).not.toMatch(/brand_ref|STYLE LOCK|Logos and text/);
    expect(() => buildPrompt("cartoon", "ice-rink", one)).toThrow(/LA Kings/);
  });
});

describe("Kings backgrounds follow the toggle (D-36)", () => {
  it("off: never kept, even if submitted", () => {
    expect(kingsBackgrounds(["gradient", "ice-rink"], false)).toEqual(["gradient"]);
  });
  it("on, just switched on: both preselected; on with a choice made: kept as chosen", () => {
    expect(kingsBackgrounds(["gradient"], true)).toEqual(["ice-rink", "crypto-arena", "gradient"]);
    expect(kingsBackgrounds(["crypto-arena"], true)).toEqual(["crypto-arena"]);
  });
  it("the schema rejects a Kings scene without the promotion", () => {
    const cfg = { ...defaultConfig("Kings Night", "+13203780782"), backgrounds: ["ice-rink" as const] };
    expect(EventConfigInputSchema.safeParse(cfg).success).toBe(false);
    expect(EventConfigInputSchema.safeParse({ ...cfg, laKings: true }).success).toBe(true);
  });
});
