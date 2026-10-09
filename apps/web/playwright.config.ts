import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

/** Test-only credentials for the e2e server; never used outside the suite. */
export const E2E_ADMIN = { user: "e2e-admin", password: "e2e-password-not-secret" };

export default defineConfig({
  testDir: "./e2e",
  // One shared in-memory server: run serially so tests do not see each other's events.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    httpCredentials: { username: E2E_ADMIN.user, password: E2E_ADMIN.password },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}/healthz`,
    // Fresh server every run: the in-memory backends must start empty.
    reuseExistingServer: false,
    env: {
      PORTRAIT_E2E: "1",
      PORTRAIT_E2E_FAKE_SYNC: "1",
      ADMIN_USER: E2E_ADMIN.user,
      ADMIN_PASSWORD: E2E_ADMIN.password,
      PUBLIC_BASE_URL: `http://localhost:${PORT}`,
      LOG_LEVEL: "warn",
    },
    timeout: 240_000,
  },
});
