import { connection } from "next/server";

/** Liveness probe (§10.7). Readiness (`/healthz/ready`) arrives with the Sync/Blob adapters. */
export async function GET() {
  await connection();
  return Response.json({ status: "ok" });
}
