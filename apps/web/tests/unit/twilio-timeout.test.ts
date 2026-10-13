import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { TWILIO_REQUEST_TIMEOUT_MS, twilioClient } from "@/lib/twilio/client";

describe("Twilio client timeout", () => {
  it("gives up on a hanging request after the short timeout, not 30 s", async () => {
    // A server that accepts the request and never answers.
    const server = createServer(() => {});
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const client = twilioClient({ accountSid: "AC" + "0".repeat(32), apiKeySid: "SK" + "0".repeat(32), apiKeySecret: "x" });
    const started = Date.now();
    const err = await client
      .request({ method: "get", uri: `http://127.0.0.1:${port}/v1/Services` })
      .then(() => null, (e: Error) => e);
    const ms = Date.now() - started;
    server.close();
    expect(err).toBeInstanceOf(Error);
    expect(ms).toBeGreaterThanOrEqual(TWILIO_REQUEST_TIMEOUT_MS - 500);
    expect(ms).toBeLessThan(15_000);
  }, 20_000);
});
