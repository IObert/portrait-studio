import "server-only";
import twilio from "twilio";
import { getEnv, requireEnv } from "../env";

/** Sync access token for an SDK identity (booth screen, print agent). Scope comes from ACL grants. */
export function twilioClientJwt(identity: string, ttlSeconds: number): string {
  const env = requireEnv(getEnv(), ["TWILIO_ACCOUNT_SID", "TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "TWILIO_SYNC_SERVICE_SID"]);
  const { AccessToken } = twilio.jwt;
  const token = new AccessToken(env.TWILIO_ACCOUNT_SID, env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET, { identity, ttl: ttlSeconds });
  token.addGrant(new AccessToken.SyncGrant({ serviceSid: env.TWILIO_SYNC_SERVICE_SID }));
  return token.toJwt();
}
