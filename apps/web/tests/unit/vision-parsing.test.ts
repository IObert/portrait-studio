import { describe, expect, it } from "vitest";
import { parseReview, parseScene, UnparseableAnswer } from "@/lib/pipeline/vision";
import { REVIEW_CRITERIA, reviewPrompt } from "@/lib/prompts/review";

describe("parseScene (fails closed, SPEC §9.2 step 3)", () => {
  it("reads subjects and pets in the requested format", () => {
    expect(parseScene("Subjects: 1\nPets: none\nPositions: centered")).toEqual({ subjects: 1, pet: null });
    expect(parseScene("Subjects: [3]\nPets: [dog]\nPositions: [group]")).toEqual({ subjects: 3, pet: "dog" });
    expect(parseScene("subjects: 2\npets: Cat.\npositions: left-right pair")).toEqual({ subjects: 2, pet: "cat" });
  });
  it("never defaults to 1 subject on a bad answer", () => {
    for (const bad of ["I see one person.", "Subjects: some\nPets: none", "Pets: none", ""]) expect(() => parseScene(bad)).toThrow(UnparseableAnswer);
  });
});

describe("parseReview (fails closed, SPEC §9.2 step 7)", () => {
  it("accepts PASS and FAIL with a reason", () => {
    expect(parseReview("PASS")).toEqual({ pass: true });
    expect(parseReview("- PASS (acceptable)")).toEqual({ pass: true });
    expect(parseReview("FAIL: 2. Subject count: a person was added")).toEqual({ pass: false, reason: "2. Subject count: a person was added" });
  });
  it("does not read PASSABLE as PASS or FAILURE as FAIL", () => {
    expect(() => parseReview("PASSABLE")).toThrow(UnparseableAnswer);
    expect(() => parseReview("FAILURE to load")).toThrow(UnparseableAnswer);
  });

  it("throws on anything else, never passes by default", () => {
    for (const bad of ["Looks great!", "I think it passes", "", "PASSABLE? maybe"]) {
      // "PASSABLE" must not count as PASS.
      expect(() => parseReview(bad), bad).toThrow(UnparseableAnswer);
    }
  });
});

describe("review prompt (PROMPTS.md §B1)", () => {
  it("numbers the five applicable criteria and includes the generation prompt", () => {
    const p = reviewPrompt(REVIEW_CRITERIA, "GEN PROMPT");
    expect(p).toContain("1. Subject likeness");
    expect(p).toContain("5. Anatomical quality");
    expect(p).not.toContain("Branding & logos");
    expect(p).toContain("---\nGEN PROMPT\n---");
    expect(p).toContain("When in doubt, PASS.");
  });
});
