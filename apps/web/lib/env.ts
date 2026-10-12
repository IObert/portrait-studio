import { z } from "zod";

/**
 * Server-side environment, validated once per process. Never import this from
 * a Client Component: none of these values may reach the browser.
 * Every variable is documented in /.env.example.
 */
const optional = z.string().trim().min(1).optional().catch(undefined);
const sid = (prefix: string) =>
  z.string().trim().regex(new RegExp(`^${prefix}[0-9a-fA-F]{32}$`), `must look like ${prefix}…`).optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  TWILIO_ACCOUNT_SID: sid("AC"),
  TWILIO_API_KEY_SID: sid("SK"),
  TWILIO_API_KEY_SECRET: optional,
  TWILIO_SYNC_SERVICE_SID: sid("IS"),
  TWILIO_AUTH_TOKEN: z.string().trim().regex(/^[0-9a-f]{32}$/, "32 hex chars").optional(),
  TWILIO_MESSAGING_SERVICE_SID: sid("MG"),
  TWILIO_VERIFY_SERVICE_SID: sid("VA"),
  TWILIO_TEMPLATE_DELIVERY_EN: z.string().regex(/^HX[0-9a-f]{32}$/).optional(),
  TWILIO_TEMPLATE_DELIVERY_PT_BR: z.string().regex(/^HX[0-9a-f]{32}$/).optional(),
  TWILIO_MEMORY_STORE_ID: z.string().trim().regex(/^mem_store_[0-9a-z]{26}$/).optional(),
  PUBLIC_BASE_URL: z.url({ protocol: /^https?$/ }).transform((u) => u.replace(/\/+$/, "")).optional(),

  AZURE_STORAGE_CONNECTION_STRING: optional,
  AZURE_STORAGE_CONTAINER: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/, "Azure container name rules")
    .default("portrait-studio"),

  /** HMAC key for /m/<token> media links (≥ 32 chars, same on every replica). */
  MEDIA_SIGNING_SECRET: z.string().min(32).optional(),
  OPENAI_API_KEY: optional,
  OPENAI_VISION_MODEL: z.string().min(1).default("gpt-6.1-sol"),
  OPENAI_CHAT_MODEL: z.string().min(1).default("gpt-6-luna"),
  /** Concurrent jobs per worker process. */
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** One image model, never switched at runtime (SPEC §9.4, docs/decisions.md D-01). */
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-2.5-flare"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function getEnv(source: Record<string, string | undefined> = process.env): Env {
  if (source === process.env && cached) return cached;
  // Treat empty strings (blank lines in .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

/** Returns the named variables, or throws listing every missing one (names only). */
export function requireEnv<K extends keyof Env>(env: Env, keys: readonly K[]): Env & { [P in K]-?: NonNullable<Env[P]> } {
  const missing = keys.filter((k) => env[k] === undefined);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  return env as Env & { [P in K]-?: NonNullable<Env[P]> };
}
