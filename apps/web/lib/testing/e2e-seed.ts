// TEST ONLY. Seeds the in-memory e2e backends with fixtures (a live event and
// one delivered portrait) so Playwright can test the share page without
// Twilio, OpenAI or Azure. Runs only when PORTRAIT_E2E_FAKE_SYNC=1.
import sharp from "sharp";
import { getEventRepo } from "../admin/context";
import { defaultConfig } from "../events/schema";
import { JobSchema } from "../jobs/schema";
import { getServices } from "../services";
import { eventObjects, Global } from "../sync/names";

export const E2E_SHARE_ID = "e2eShareFixture0000000001";

export async function seedE2e(): Promise<void> {
  if (process.env.PORTRAIT_E2E_FAKE_SYNC !== "1") return;
  await seedShare();
  await seedBooth();
}

/** A live event with CTA, one slideshow image and one flagged job (booth + review tests). */
async function seedBooth(): Promise<void> {
  const { sync, blob } = getServices();
  const events = await getEventRepo();
  const slug = "e2e-booth";
  if (await events.get(slug)) return;
  await events.create(slug, { ...defaultConfig("E2E Booth", "+13203780782"), ctaText: { headline: "Get your portrait", steps: ["Scan the code", "Send a selfie", "Pick a style"] } });
  await events.setState(slug, "live");
  const ev = eventObjects(slug);
  for (const m of [ev.jobs, ev.slideshow, ev.print]) await sync.ensureMap(m);
  const img = (hex: string) => sharp({ create: { width: 1200, height: 1800, channels: 3, background: hex } }).jpeg().toBuffer();
  const job = (id: string, state: "delivered" | "flagged") =>
    JobSchema.parse({
      jobId: id, address: "whatsapp:+10000000001", channel: "whatsapp", style: "pop-art", background: "solid-white",
      selfieBlob: `events/${slug}/selfies/${id}.jpg`, outputBlobs: { printPng: `events/${slug}/generated/${id}.print.png`, deliveryJpeg: `events/${slug}/generated/${id}.jpg` },
      shareId: `${id}_share_000000000000`, subjects: 1, state,
      aiReview: state === "flagged" ? { result: "fail", reason: "2. Subject count: an extra person was added" } : { result: "pass", reason: "" },
      timestamps: { [state]: new Date().toISOString() },
    });
  for (const [id, state, hex] of [["e2e_slide_01", "delivered", "#0ea5e9"], ["e2e_flag_01", "flagged", "#f59e0b"]] as const) {
    await blob.put(`events/${slug}/generated/${id}.jpg`, await img(hex), "image/jpeg");
    await blob.put(`events/${slug}/selfies/${id}.jpg`, await img("#64748b"), "image/jpeg");
    await sync.map(ev.jobs, JobSchema).put(id, job(id, state));
  }
  await sync.raw.createItem(ev.slideshow, "e2e_slide_01", { blobPath: `events/${slug}/generated/e2e_slide_01.jpg`, addedAt: new Date().toISOString() });
  // A delivered job always has a share record (written at delivery).
  await sync.ensureMap(Global.shares);
  await sync.raw.createItem(Global.shares, "e2e_slide_01_share_000000000000", { eventSlug: slug, jobId: "e2e_slide_01", createdAt: new Date().toISOString() });
}

async function seedShare(): Promise<void> {
  const { sync, blob } = getServices();
  const events = await getEventRepo();
  const slug = "e2e-share";
  if (await events.get(slug)) return;
  await events.create(slug, { ...defaultConfig("E2E Summit", "+13203780782"), shareText: "My portrait from E2E Summit" });
  await events.setState(slug, "live");
  const jpeg = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#7c3aed" } }).jpeg().toBuffer();
  const deliveryJpeg = `events/${slug}/generated/e2e_job_01.jpg`;
  await blob.put(deliveryJpeg, jpeg, "image/jpeg");
  const ev = eventObjects(slug);
  await sync.ensureMap(ev.jobs);
  await sync.map(ev.jobs, JobSchema).put("e2e_job_01", JobSchema.parse({
    jobId: "e2e_job_01", address: "whatsapp:+10000000000", channel: "whatsapp", style: "anime", background: "gradient",
    selfieBlob: `events/${slug}/selfies/x.jpg`, outputBlobs: { printPng: `events/${slug}/generated/e2e_job_01.print.png`, deliveryJpeg },
    shareId: E2E_SHARE_ID, state: "delivered", timestamps: { delivered: new Date().toISOString() },
  }));
  await sync.ensureMap(Global.shares);
  await sync.raw.createItem(Global.shares, E2E_SHARE_ID, { eventSlug: slug, jobId: "e2e_job_01", createdAt: new Date().toISOString() });
}
