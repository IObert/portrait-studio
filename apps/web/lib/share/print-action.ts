"use server";

import { z } from "zod";
import { catalogs } from "@/i18n";
import { requestPrint } from "../delivery/print-request";
import { getEnv, requireEnv } from "../env";
import { log } from "../log";
import { signMedia } from "../media-token";
import { addressFromKey } from "../pipeline/worker";
import { getServices } from "../services";
import { shareTarget } from "./load";

export interface SharePrintState {
  ok?: boolean;
  message?: string;
  left?: number;
}

const Input = z.object({ shareId: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/) });

/**
 * Print button on the share page (D-26, user decision): anyone with the link
 * may use it. It takes one of the owner's prints and never puts the portrait
 * on the booth screen. The page sends only the share id; the job and owner
 * are looked up here, so it cannot reach anyone else's portrait.
 */
export async function sharePrintAction(_prev: SharePrintState, form: FormData): Promise<SharePrintState> {
  const parsed = Input.safeParse({ shareId: form.get("shareId") });
  const fallback = catalogs.en.delivery.printUnavailable;
  if (!parsed.success) return { message: fallback };
  try {
    const target = await shareTarget(parsed.data.shareId);
    if (!target) return { message: fallback };
    const { event, job } = target;
    const d = catalogs[event.config.language].delivery;
    const address = addressFromKey(job.address);
    if (!address) return { message: d.printUnavailable };
    const env = requireEnv(getEnv(), ["MEDIA_SIGNING_SECRET", "PUBLIC_BASE_URL"]);
    const mediaUrl = (p: string, ttl: number) => new URL(`/m/${signMedia(env.MEDIA_SIGNING_SECRET, p, ttl)}`, env.PUBLIC_BASE_URL).toString();
    const r = await requestPrint({ sync: getServices().sync, mediaUrl }, event, job.address, address, job.jobId, new Date());
    log.info({ event: "print_requested", via: "share", slug: event.slug, jobId: job.jobId, result: r.status }, "print requested");
    if (r.status === "queued") return { ok: true, message: d.printQueued({ printsLeft: r.printsLeft }), left: r.printsLeft };
    return { message: r.status === "none-left" ? d.printNoneLeft : r.status === "already" ? d.printAlready : d.printUnavailable, left: r.status === "none-left" ? 0 : undefined };
  } catch (err) {
    log.error({ event: "share_print_failed", err: (err as Error).message }, "share print failed");
    return { message: fallback };
  }
}
