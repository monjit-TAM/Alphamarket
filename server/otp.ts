/**
 * Phone OTP for AlphaMarket registration, sent through MSG91's Flow API.
 *
 * We generate the OTP ourselves, send it with a DLT-approved SMS template
 * (created under MSG91 → SMS → Templates, variable ##otp##), and verify it
 * on our side. Same approach as AlphaLens MF.
 *
 * Env:
 *   MSG91_AUTH_KEY     MSG91 auth key
 *   MSG91_TEMPLATE_ID  MSG91 template ID of alphamarket_verify_otp
 *   MSG91_OTP_VAR      template variable name (default "otp")
 *
 * If the key or template ID is blank, OTP is treated as switched off.
 */
import crypto from "crypto";

const FLOW_URL = "https://control.msg91.com/api/v5/flow";

export const OTP_TTL_MS = 5 * 60 * 1000;   // OTP valid for 5 minutes
export const OTP_MAX_ATTEMPTS = 5;          // wrong tries before a new OTP is needed
export const OTP_RESEND_MS = 30 * 1000;     // gap between sends to one number
const PHONE_HOURLY_CAP = 5;                 // sends per number per hour
const IP_HOURLY_CAP = 15;                   // sends per IP per hour

export function isOtpConfigured(): boolean {
  return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);
}

/** Strip +91 / 91 / spaces / dashes down to a 10-digit number. */
export function normalizePhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isValidIndianMobile(phone: string): boolean {
  return /^[6-9][0-9]{9}$/.test(phone);
}

export function generateOtp(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOtp(phone: string, otp: string): string {
  const secret = process.env.SESSION_SECRET || "";
  return crypto.createHash("sha256").update(`${phone}:${otp}:${secret}`).digest("hex");
}

export function otpMatches(phone: string, otp: string, storedHash: string): boolean {
  const a = Buffer.from(hashOtp(phone, String(otp || "").trim()), "hex");
  const b = Buffer.from(String(storedHash || ""), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── Simple in-memory send limits (single PM2 process) ──
const sendLog = new Map<string, number[]>();

function recent(key: string, windowMs: number): number[] {
  const now = Date.now();
  const list = (sendLog.get(key) || []).filter((t) => now - t < windowMs);
  sendLog.set(key, list);
  return list;
}

/** Returns an error message if this send should be blocked, else null. */
export function checkSendLimits(phone: string, ip: string): string | null {
  const hour = 60 * 60 * 1000;
  const phoneSends = recent(`p:${phone}`, hour);
  const last = phoneSends[phoneSends.length - 1];
  if (last && Date.now() - last < OTP_RESEND_MS) {
    const wait = Math.ceil((OTP_RESEND_MS - (Date.now() - last)) / 1000);
    return `Please wait ${wait}s before requesting another OTP`;
  }
  if (phoneSends.length >= PHONE_HOURLY_CAP) {
    return "Too many OTP requests for this number. Please try again in an hour.";
  }
  if (recent(`i:${ip}`, hour).length >= IP_HOURLY_CAP) {
    return "Too many OTP requests. Please try again later.";
  }
  return null;
}

export function recordSend(phone: string, ip: string): void {
  const now = Date.now();
  sendLog.set(`p:${phone}`, [...(sendLog.get(`p:${phone}`) || []), now]);
  sendLog.set(`i:${ip}`, [...(sendLog.get(`i:${ip}`) || []), now]);
}

// Clear stale entries every 10 minutes so the map doesn't grow forever
setInterval(() => {
  const hour = 60 * 60 * 1000;
  sendLog.forEach((_v, key) => {
    if (recent(key, hour).length === 0) sendLog.delete(key);
  });
}, 10 * 60 * 1000).unref();

/**
 * Registration gate shared by every sign-up endpoint.
 * Returns an error message if the phone is missing/invalid or not OTP-verified
 * in this session, otherwise null. Bypassed when OTP is not configured.
 */
export function phoneVerificationError(session: any, rawPhone: unknown): string | null {
  if (!rawPhone) return "Mobile number is required";
  const phone = normalizePhone(String(rawPhone));
  if (!isValidIndianMobile(phone)) return "Please enter a valid 10-digit Indian mobile number";
  if (!isOtpConfigured()) return null;
  if (!session?.otpVerified || session?.otpPhone !== phone) {
    return "Please verify your mobile number with OTP before registering";
  }
  return null;
}

/** Call once an account is created so one verification can't be reused. */
export function clearPhoneVerification(session: any): void {
  if (!session) return;
  session.otpVerified = false;
  session.otpPhone = null;
  session.otpHash = null;
}

/** Send the OTP SMS through MSG91 Flow. */
export async function sendOtpSms(phone: string, otp: string): Promise<{ success: boolean; message: string }> {
  const varName = process.env.MSG91_OTP_VAR || "otp";
  try {
    const res = await fetch(FLOW_URL, {
      method: "POST",
      headers: {
        authkey: process.env.MSG91_AUTH_KEY || "",
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        template_id: process.env.MSG91_TEMPLATE_ID,
        short_url: "0",
        recipients: [{ mobiles: `91${phone}`, [varName]: otp }],
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.type === "error") {
      console.error(`[OTP] MSG91 refused send to 91${phone} (${res.status}):`, data);
      return { success: false, message: "Could not send OTP right now. Please try again." };
    }
    console.log(`[OTP] Sent to 91${phone}: ${data?.type || "ok"} ${data?.message || ""}`);
    return { success: true, message: "OTP sent successfully" };
  } catch (err: any) {
    console.error("[OTP] Send error:", err.message);
    return { success: false, message: "OTP service error. Please try again." };
  }
}
