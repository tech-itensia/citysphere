import pino from "pino";

export const logger = pino({
  name: process.env.SERVICE_NAME ?? "scaas",
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "scaas" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
