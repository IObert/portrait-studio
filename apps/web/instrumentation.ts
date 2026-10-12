/** Runs once per server start (Next.js instrumentation). */
export async function register() {
  // Test-only fixtures for the e2e suite; a no-op unless PORTRAIT_E2E_FAKE_SYNC=1.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PORTRAIT_E2E_FAKE_SYNC === "1") {
    const { seedE2e } = await import("./lib/testing/e2e-seed");
    await seedE2e();
  }
}
