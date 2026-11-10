/**
 * MSG91 OTP Service for AlphaMarket
 *
 * Uses MSG91's OTP API to send and verify OTPs for phone number verification
 * during registration.
 *
 * Required env vars:
 *   MSG91_AUTH_KEY   - MSG91 auth key from dashboard
 *   MSG91_TEMPLATE_ID - DLT-approved SMS template ID
 *
 * If MSG91 is not configured (env vars missing), OTP verification is bypassed
 * so the app still works during development or before DLT approval.
 */

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY || "";
const MSG91_TEMPLATE_ID = process.env.MSG91_TEMPLATE_ID || "";
const MSG91_BASE_URL = "https://control.msg91.com/api/v5";

/** Normalize a phone number to 10 digits (strip +91, 91 prefix, spaces, dashes) */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-\(\)\+]/g, "");
  if (digits.startsWith("91") && digits.length === 12) return digits.slice(2);
  if (digits.length === 10 && /^[6-9]/.test(digits)) return digits;
  return digits;
}

/** Check if MSG91 is configured */
export function isOtpConfigured(): boolean {
  return !!(MSG91_AUTH_KEY && MSG91_TEMPLATE_ID);
}

/**
 * Send OTP to a mobile number via MSG91
 * Returns { success, message, type }
 */
export async function sendOtp(mobile: string): Promise<{ success: boolean; message: string; type: string }> {
  const phone = normalizePhone(mobile);

  if (!/^[6-9][0-9]{9}$/.test(phone)) {
    return { success: false, message: "Invalid Indian mobile number", type: "error" };
  }

  if (!isOtpConfigured()) {
    console.warn("[OTP] MSG91 not configured — skipping OTP send for", phone);
    return { success: true, message: "OTP service not configured — verification bypassed", type: "bypass" };
  }

  try {
    const url = `${MSG91_BASE_URL}/otp?template_id=${MSG91_TEMPLATE_ID}&mobile=91${phone}&authkey=${MSG91_AUTH_KEY}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();

    if (data.type === "success" || data.type === "error" && data.message?.includes("already")) {
      console.log(`[OTP] Sent to 91${phone}:`, data.type);
      return { success: true, message: "OTP sent successfully", type: "success" };
    }

    console.error("[OTP] Send failed:", data);
    return { success: false, message: data.message || "Failed to send OTP", type: "error" };
  } catch (err: any) {
    console.error("[OTP] Send error:", err.message);
    return { success: false, message: "OTP service error — please try again", type: "error" };
  }
}

/**
 * Verify OTP entered by user via MSG91
 */
export async function verifyOtp(mobile: string, otp: string): Promise<{ success: boolean; message: string; type: string }> {
  const phone = normalizePhone(mobile);

  if (!/^[6-9][0-9]{9}$/.test(phone)) {
    return { success: false, message: "Invalid mobile number", type: "error" };
  }

  if (!otp || otp.length < 4) {
    return { success: false, message: "Invalid OTP", type: "error" };
  }

  if (!isOtpConfigured()) {
    console.warn("[OTP] MSG91 not configured — bypassing verification for", phone);
    return { success: true, message: "OTP verification bypassed", type: "bypass" };
  }

  try {
    const url = `${MSG91_BASE_URL}/otp/verify?authkey=${MSG91_AUTH_KEY}&mobile=91${phone}&otp=${otp}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();

    if (data.type === "success") {
      console.log(`[OTP] Verified for 91${phone}`);
      return { success: true, message: "OTP verified successfully", type: "success" };
    }

    console.error("[OTP] Verify failed:", data);
    return { success: false, message: data.message || "Invalid OTP", type: "error" };
  } catch (err: any) {
    console.error("[OTP] Verify error:", err.message);
    return { success: false, message: "Verification error — please try again", type: "error" };
  }
}

/**
 * Resend OTP via MSG91 (uses retry endpoint)
 */
export async function resendOtp(mobile: string, retryType?: string): Promise<{ success: boolean; message: string; type: string }> {
  const phone = normalizePhone(mobile);

  if (!isOtpConfigured()) {
    return { success: true, message: "OTP service not configured — verification bypassed", type: "bypass" };
  }

  try {
    const url = `${MSG91_BASE_URL}/otp/retry?authkey=${MSG91_AUTH_KEY}&mobile=91${phone}&retrytype=${retryType || "text"}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    const data = await response.json();

    if (data.type === "success") {
      console.log(`[OTP] Resent to 91${phone}`);
      return { success: true, message: "OTP resent successfully", type: "success" };
    }

    console.error("[OTP] Resend failed:", data);
    return { success: false, message: data.message || "Failed to resend OTP", type: "error" };
  } catch (err: any) {
    console.error("[OTP] Resend error:", err.message);
    return { success: false, message: "OTP service error — please try again", type: "error" };
  }
}
