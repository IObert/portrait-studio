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
  const { sync, blob } = getServices();
  const events = await getEventRepo();
  const slug = "e2e-share";
  if (await events.get(slug)) return;
  await events.create(slug, { ...defaultConfig("E2E Summit", "+13203780782"), shareText: "My AI portrait from #E2ESummit" });
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
