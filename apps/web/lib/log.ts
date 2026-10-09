import pino from "pino";
import { getEnv } from "./env";

/** Structured JSON logger shared by web and worker. Never log personal data. */
export const log = pino({
  level: getEnv().LOG_LEVEL,
  base: { service: process.env.PORTRAIT_PROCESS ?? "web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label.toUpperCase() }) },
});
