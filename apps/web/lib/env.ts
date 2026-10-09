import { z } from "zod";

/**
 * Server-side environment, validated once per process. Never import this from
 * a Client Component: none of these values may reach the browser.
 *
 * Milestone a only needs the basics; later milestones add Twilio, OpenAI and
 * Azure variables here (all documented in /.env.example).
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  /** One image model, never switched at runtime (SPEC §9.4, docs/decisions.md D-01). */
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-2.5-flare"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}
