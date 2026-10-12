import { connection } from "next/server";
import { getEventRepo } from "@/lib/admin/context";
import { buildBoothState, slideIds } from "@/lib/booth/state";
import { log } from "@/lib/log";
import { SlugSchema } from "@/lib/sync/names";

const POLL_MS = 2_000;
const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events for the booth screen (SPEC §10.4, docs/decisions.md D-06).
 * Behind basic auth (proxy.ts). Each connection polls Sync for this one event
 * and pushes a full state whenever the event state, CTA or slideshow changes.
 * Nothing is kept between connections (SPEC §1.2).
 */
export async function GET(request: Request, ctx: RouteContext<"/booth/[slug]/stream">) {
  await connection();
  const slug = SlugSchema.safeParse((await ctx.params).slug);
  if (!slug.success) return new Response("Not found", { status: 404 });
  const repo = await getEventRepo();
  if (!(await repo.get(slug.data))) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  const signal = request.signal;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* client gone */
        }
      };
      // Tell the client how long to wait before reconnecting on its own.
      send("retry: 3000\n\n");
      let lastKey = "";
      let lastBeat = Date.now();
      while (!signal.aborted) {
        try {
          const event = await repo.get(slug.data);
          if (!event || event.state === "draft") {
            send(`event: gone\ndata: {}\n\n`);
            break;
          }
          const ids = event.state === "live" ? await slideIds(slug.data) : [];
          const key = JSON.stringify([event.state, event.updatedAt, ids]);
          if (key !== lastKey) {
            const state = await buildBoothState(event);
            if (state) send(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
            lastKey = key;
          } else if (Date.now() - lastBeat > HEARTBEAT_MS) {
            send(": keep-alive\n\n"); // comment line; keeps idle proxies from closing the stream
            lastBeat = Date.now();
          }
        } catch (err) {
          // A Sync hiccup: keep the connection; the client keeps showing the last state.
          log.warn({ event: "booth_poll_failed", slug: slug.data, err: (err as Error).message }, "booth poll failed");
        }
        await new Promise((r) => {
          const t = setTimeout(r, POLL_MS);
          signal.addEventListener("abort", () => (clearTimeout(t), r(null)), { once: true });
        });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
