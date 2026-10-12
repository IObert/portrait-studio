"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { log } from "../log";
import { Messenger } from "../messaging/outbound";
import { deliveryDeps } from "../pipeline/context";
import { approveFlagged, discardFlagged, removeFromPrintQueue, removeFromSlideshow, reprint, ReviewError } from "../review/actions";
import { getServices } from "../services";
import { SlugSchema } from "../sync/names";
import { createTwilioMessagingApi } from "../twilio/messaging-api";
import { getEnv, requireEnv } from "../env";
import { getEventRepo } from "./context";
import { requireAdmin } from "./guard";

export interface ReviewState {
  ok?: boolean;
  message?: string;
}

const Input = z.object({
  slug: SlugSchema,
  jobId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  action: z.enum(["approve", "discard", "slideshow_remove", "print_remove", "reprint"]),
  actor: z.string().trim().max(60).optional(),
});

/** One entry point for all review buttons (SPEC §10.3). Auth is re-checked here. */
export async function reviewAction(_prev: ReviewState, form: FormData): Promise<ReviewState> {
  await requireAdmin();
  const parsed = Input.safeParse({
    slug: form.get("slug"),
    jobId: form.get("jobId"),
    action: form.get("action"),
    actor: String(form.get("actor") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { message: "Invalid request" };
  const { slug, jobId, action, actor } = parsed.data;
  try {
    const event = await (await getEventRepo()).require(slug);
    const { sync } = getServices();
    const base = { sync, log };
    switch (action) {
      case "approve": {
        const env = requireEnv(getEnv(), ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_MESSAGING_SERVICE_SID"]);
        const messenger = new Messenger(
          createTwilioMessagingApi({ accountSid: env.TWILIO_ACCOUNT_SID, apiKeySid: env.TWILIO_API_KEY_SID, apiKeySecret: env.TWILIO_API_KEY_SECRET }),
          sync,
          env.TWILIO_MESSAGING_SERVICE_SID,
          log,
        );
        await messenger.init();
        const r = await approveFlagged({ ...base, delivery: deliveryDeps(sync, messenger) }, event, jobId, actor);
        revalidatePath(`/admin/events/${slug}/review`);
        return { ok: true, message: r === "sent" ? "Approved and sent" : "Approved; the attendee is outside the WhatsApp window and no delivery template is set up" };
      }
      case "discard":
        await discardFlagged(base, event, jobId, actor);
        break;
      case "slideshow_remove":
        await removeFromSlideshow(base, event, jobId, actor);
        break;
      case "print_remove":
        await removeFromPrintQueue(base, event, jobId, actor);
        break;
      case "reprint":
        await reprint(base, event, jobId, actor);
        break;
    }
    revalidatePath(`/admin/events/${slug}/review`);
    return { ok: true, message: "Done" };
  } catch (err) {
    if (err instanceof ReviewError) return { message: err.message };
    log.error({ event: "review_action_failed", action, slug, jobId, err: (err as Error).message }, "review action failed");
    return { message: "Something went wrong" };
  }
}
