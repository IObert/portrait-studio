import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "@/i18n";
import { ACTION_SLIDESHOW } from "@/lib/conversation/actions";
import { newSession, SessionSchema } from "@/lib/conversation/session";
import { readSlideshowAnswer } from "@/lib/delivery/slideshow";

const c = catalogs.en;
const NOW = new Date("2026-10-20T12:00:00Z");
const withQuestion = (askedAt?: string) => ({ ...newSession("en", NOW), pendingSlideshow: { jobId: "job_00000001", group: false, print: false, ...(askedAt ? { askedAt } : {}) } });
const say = (askedAt: string | undefined, text: string) => readSlideshowAnswer(withQuestion(askedAt), c, { channel: "sms", text });

describe("SMS keyword answers to the slideshow question", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it("a recent YES / NO is an answer", () => {
    expect(say("2026-10-20T11:55:00Z", "YES")).toEqual({ jobId: "job_00000001", answer: "yes" });
    expect(say("2026-10-20T11:55:00Z", "no")).toEqual({ jobId: "job_00000001", answer: "no" });
  });

  it("the same word half an hour later is not", () => {
    expect(say("2026-10-20T11:30:00Z", "ok")).toBeNull();
  });

  it("a question stored before the timestamp existed counts as expired but still loads", () => {
    const stored = SessionSchema.parse(withQuestion());
    expect(stored.pendingSlideshow).toMatchObject({ jobId: "job_00000001" });
    expect(readSlideshowAnswer(stored, c, { channel: "sms", text: "yes" })).toBeNull();
  });

  it("buttons work however old the question is", () => {
    const r = readSlideshowAnswer(withQuestion("2026-10-01T00:00:00Z"), c, { channel: "whatsapp", text: "", selection: ACTION_SLIDESHOW.yes("job_00000001") });
    expect(r).toEqual({ jobId: "job_00000001", answer: "yes" });
  });
});
