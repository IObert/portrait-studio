import "server-only";
import { headers } from "next/headers";
import { checkBasicAuth } from "../auth/basic";

/**
 * Re-checks basic auth inside every Server Action and admin data read. The
 * proxy already gates /admin, but actions are reachable by direct POST, so the
 * proxy is not treated as the only boundary (Next.js data-security guide).
 */
export async function requireAdmin(): Promise<void> {
  const h = await headers();
  if (!(await checkBasicAuth(h.get("authorization"), process.env.ADMIN_USER, process.env.ADMIN_PASSWORD))) {
    throw new Error("Unauthorized");
  }
}
