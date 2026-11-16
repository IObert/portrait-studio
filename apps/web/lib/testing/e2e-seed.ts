// TEST ONLY. Seeds the in-memory e2e backends with fixtures (a live event and
// one delivered portrait) so Playwright can test the share page without
// Twilio, OpenAI or Azure. Runs only when PORTRAIT_E2E_FAKE_SYNC=1.
import sharp from "sharp";
import { getEventRepo } from "../admin/context";
import { defaultConfig } from "../events/schema";
import { newSession } from "../conversation/session";
import { JobSchema } from "../jobs/schema";
import { getServices } from "../services";
import { eventObjects, Global } from "../sync/names";

export const E2E_SHARE_ID = "e2eShareFixture0000000001";

export async function seedE2e(): Promise<void> {
  if (process.env.PORTRAIT_E2E_FAKE_SYNC !== "1") return;
  await seedShare();
  await seedPrintShare();
  await seedPending();
  await seedBooth();
}

/** A live event with CTA, one slideshow image and one flagged job (booth + review tests). */
async function seedBooth(): Promise<void> {
  const { sync, blob } = getServices();
  const events = await getEventRepo();
  const slug = "e2e-booth";
  if (await events.get(slug)) return;
  await events.create(slug, { ...defaultConfig("E2E Booth", "+13203780782"), printCalibration: { top: 1, right: 2, bottom: 3, left: 4 }, ctaText: { headline: "Get your portrait", steps: ["Scan the code", "Send a selfie", "Pick a style"] } });
  await events.setState(slug, "live");
  const ev = eventObjects(slug);
  for (const m of [ev.jobs, ev.slideshow, ev.print]) await sync.ensureMap(m);
  const img = (hex: string) => sharp({ create: { width: 1200, height: 1800, channels: 3, background: hex } }).jpeg().toBuffer();
  const job = (id: string, state: "delivered" | "flagged") =>
    JobSchema.parse({
      jobId: id, address: "whatsapp:+10000000001", channel: "whatsapp", style: "pop-art", background: "solid-white",
      selfieBlob: `events/${slug}/selfies/${id}.jpg`, outputBlobs: { printPng: `events/${slug}/generated/${id}.print.png`, deliveryJpeg: `events/${slug}/generated/${id}.jpg` },
      shareId: `${id}_share_000000000000`, subjects: 1, state,
      aiReview: state === "flagged" ? { reason: "2. Subject count: an extra person was added" } : { reason: "" },
      timestamps: { [state]: new Date().toISOString() },
    });
  for (const [id, state, hex] of [["e2e_slide_01", "delivered", "#0ea5e9"], ["e2e_flag_01", "flagged", "#f59e0b"]] as const) {
    await blob.put(`events/${slug}/generated/${id}.jpg`, await img(hex), "image/jpeg");
    await blob.put(`events/${slug}/selfies/${id}.jpg`, await img("#64748b"), "image/jpeg");
    await sync.map(ev.jobs, JobSchema).put(id, job(id, state));
  }
  // The print PNG of the delivered job: the download route fits it to the event's printer calibration (D-45).
  await blob.put(`events/${slug}/generated/e2e_slide_01.print.png`, await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#0ea5e9" } }).png().toBuffer(), "image/png");
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

/** Share page with printing on: the owner has one print left (D-26). */
export const E2E_PRINT_SHARE_ID = "e2ePrintShareFixture000001";
/**
 * An event with work that is not done, for the Review tabs "Printing" and "In progress" (D-54): a print that has been
 * queued for hours while the agent is online and ready, a failed print, and jobs in every unfinished state.
 */
async function seedPending(): Promise<void> {
  const { sync, blob } = getServices();
  const events = await getEventRepo();
  const slug = "e2e-pending";
  if (await events.get(slug)) return;
  await events.create(slug, { ...defaultConfig("E2E Pending Work", "+13203780782"), printingEnabled: true });
  await events.setState(slug, "live");
  const ev = eventObjects(slug);
  for (const m of [ev.jobs, ev.print, ev.sessions]) await sync.ensureMap(m); // as every real event has
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const jpeg = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#7c3aed" } }).jpeg().toBuffer();
  const job = (id: string, state: string, over: Record<string, unknown> = {}) =>
    JobSchema.parse({
      jobId: id, address: "whatsapp:+10000000002", channel: "whatsapp", style: "anime", background: "gradient", subjects: 2,
      selfieBlob: `events/${slug}/selfies/${id}.jpg`, shareId: `${id}_share`.padEnd(24, "x"), state, timestamps: { [state]: ago(10) }, ...over,
    });
  // Delivered portraits with a print that is waiting (3 hours) and one that failed.
  // Three delivered portraits, told apart by style: one with a print waiting, one with a failed print that is on the booth screen, one never printed.
  for (const [id, style] of [["pend_print_wait", "anime"], ["pend_print_fail", "pop-art"], ["pend_never_printed", "sketch"]] as const) {
    const deliveryJpeg = `events/${slug}/generated/${id}.jpg`;
    await blob.put(deliveryJpeg, jpeg, "image/jpeg");
    await sync.map(ev.jobs, JobSchema).put(id, job(id, "delivered", { style, outputBlobs: { printPng: `events/${slug}/generated/${id}.print.png`, deliveryJpeg } }));
  }
  await sync.ensureMap(ev.slideshow);
  await sync.raw.createItem(ev.slideshow, "pend_print_fail", { blobPath: `events/${slug}/generated/pend_print_fail.jpg`, addedAt: new Date().toISOString() });
  const printItem = (id: string, state: string, over: Record<string, unknown> = {}) => ({
    jobId: id, blobPath: `events/${slug}/generated/${id}.print.png`, url: "https://example.test/m/x", who: "whatsapp:+10…02", state, attempts: 0, leaseUntil: null, error: null, reprint: false, timestamps: { queued: ago(180) }, ...over,
  });
  await sync.raw.createItem(ev.print, "pend_print_wait", printItem("pend_print_wait", "queued"));
  await sync.raw.createItem(ev.print, "pend_print_fail", printItem("pend_print_fail", "failed", { attempts: 3, error: "Printer cancelled the job", timestamps: { queued: ago(120), failed: ago(110) }, settledAt: ago(100) }));
  await sync.raw.createItem(ev.print, "pend_print_done", printItem("pend_print_done", "printed", { timestamps: { queued: ago(200), printed: ago(199) }, settledAt: ago(198) })); // not pending: must not be listed
  // An agent that is online with a ready printer, so the waiting print is "not picked up".
  await sync.raw.putDocument(ev.printer, { agentVersion: "0.1.0", mode: "cups", queue: "DNP_DS620", status: "idle", detail: "", heartbeatAt: new Date(Date.now() + 365 * 24 * 3600_000).toISOString() });
  // Jobs that are not done.
  await sync.map(ev.jobs, JobSchema).put("pend_job_screen", job("pend_job_screen", "screening", { subjects: null, style: null, background: null, timestamps: { screening: ago(12) } }));
  await sync.map(ev.jobs, JobSchema).put("pend_job_choice", job("pend_job_choice", "awaiting_choice", { style: null, background: null, timestamps: { awaiting_choice: ago(40) } }));
  await sync.map(ev.jobs, JobSchema).put("pend_job_gen", job("pend_job_gen", "processing", { timestamps: { processing: ago(30) }, attempts: 1 }));
  await sync.map(ev.jobs, JobSchema).put("pend_job_fail", job("pend_job_fail", "failed", { error: "image model refused the request", attempts: 3, timestamps: { failed: ago(20) } }));
}

async function seedPrintShare(): Promise<void> {
  const { sync, blob } = getServices();
  const events = await getEventRepo();
  const slug = "e2e-print";
  if (await events.get(slug)) return;
  await events.create(slug, { ...defaultConfig("E2E Print Fair", "+13203780782"), printingEnabled: true, maxPrintsPerPerson: 1 });
  await events.setState(slug, "live");
  const jpeg = await sharp({ create: { width: 1200, height: 1800, channels: 3, background: "#0f766e" } }).jpeg().toBuffer();
  const deliveryJpeg = `events/${slug}/generated/e2e_print_01.jpg`;
  await blob.put(deliveryJpeg, jpeg, "image/jpeg");
  const ev = eventObjects(slug);
  for (const m of [ev.jobs, ev.sessions]) await sync.ensureMap(m);
  const address = "whatsapp:+10000000001";
  await sync.map(ev.jobs, JobSchema).put("e2e_print_01", JobSchema.parse({
    jobId: "e2e_print_01", address, channel: "whatsapp", style: "anime", background: "gradient",
    selfieBlob: `events/${slug}/selfies/x.jpg`, outputBlobs: { printPng: `events/${slug}/generated/e2e_print_01.print.png`, deliveryJpeg },
    shareId: E2E_PRINT_SHARE_ID, state: "delivered", timestamps: { delivered: new Date().toISOString() },
  }));
  await sync.raw.createItem(ev.sessions, address, { ...newSession("en", new Date()), step: "ready", optedIn: true, counters: { delivered: 1, printed: 0, printsReserved: 0, inFlight: 0 } });
  await sync.ensureMap(Global.shares);
  await sync.raw.createItem(Global.shares, E2E_PRINT_SHARE_ID, { eventSlug: slug, jobId: "e2e_print_01", createdAt: new Date().toISOString() });
}
