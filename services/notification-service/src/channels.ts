import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { env, envInt, logger } from "@scaas/common";

export interface Message { subject: string; text: string; payload: Record<string, unknown> }

const transport = nodemailer.createTransport({
  host: env("SMTP_HOST", "mailhog"),
  port: envInt("SMTP_PORT", 1025),
  secure: false,
  auth: process.env.SMTP_USER ? { user: env("SMTP_USER"), pass: env("SMTP_PASSWORD") } : undefined,
});
const FROM = env("SMTP_FROM", "SCaaS Command Centre <alerts@scaas.local>");

export async function sendEmail(to: string, m: Message): Promise<void> {
  await transport.sendMail({ from: FROM, to, subject: m.subject, text: m.text });
}

/** Webhook with an HMAC-style signature so receivers (Slack/Teams relays, CAFM, ERP) can verify the sender. */
export async function sendWebhook(url: string, secret: string | null, m: Message): Promise<void> {
  const body = JSON.stringify({ subject: m.subject, text: m.text, ...m.payload });
  const sig = createHash("sha256").update(`${secret ?? ""}.${body}`).digest("hex");
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-scaas-signature": sig }, body });
  if (!res.ok) throw new Error(`webhook ${url} -> ${res.status}`);
}

/** SMS / push providers are pluggable; the MVP logs them (wire Twilio, MSG91, Firebase here). */
export async function sendSms(to: string, m: Message): Promise<void> {
  logger.info({ to, text: m.subject }, "SMS (stub provider)");
}

export async function sendPush(to: string, m: Message): Promise<void> {
  logger.info({ to, text: m.subject }, "Push (stub provider)");
}
