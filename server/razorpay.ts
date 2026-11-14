/**
 * Razorpay payment gateway (alternative to Cashfree).
 *
 * Env:
 *   RAZORPAY_KEY_ID      rzp_live_... (or rzp_test_...)
 *   RAZORPAY_KEY_SECRET  matching secret
 *   PAYMENT_GATEWAY      "razorpay" to route strategy payments here (default: cashfree)
 */
import crypto from "crypto";

const API = "https://api.razorpay.com/v1";

export function isRazorpayConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function activeGateway(): "razorpay" | "cashfree" {
  return (process.env.PAYMENT_GATEWAY || "").toLowerCase() === "razorpay" && isRazorpayConfigured()
    ? "razorpay"
    : "cashfree";
}

/** Razorpay order IDs always start with "order_"; Cashfree ones never do. */
export function isRazorpayOrderId(id: string | null | undefined): boolean {
  return !!id && id.startsWith("order_");
}

function authHeader(): string {
  const token = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  return `Basic ${token}`;
}

async function call(method: "GET" | "POST", path: string, body?: object): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.description || `Razorpay error (${res.status})`;
    console.error(`[Razorpay] ${method} ${path} failed:`, data?.error || data);
    throw new Error(msg);
  }
  return data;
}

export async function createRazorpayOrder(params: {
  receipt: string;            // our internal order ID (max 40 chars)
  amountRupees: number;
  notes?: Record<string, string>;
}): Promise<{ id: string; amount: number; currency: string }> {
  const amount = Math.round(params.amountRupees * 100); // paise
  if (!Number.isFinite(amount) || amount < 100) throw new Error("Amount must be at least ₹1");
  return call("POST", "/orders", {
    amount,
    currency: "INR",
    receipt: params.receipt.slice(0, 40),
    notes: params.notes || {},
  });
}

/**
 * Check whether a Razorpay order has been paid.
 * Returns PAID with the captured payment's method and ID, otherwise the order status in caps.
 */
export async function getRazorpayOrderStatus(razorpayOrderId: string): Promise<{
  status: string;           // "PAID" | "ACTIVE" | "ATTEMPTED" | "CREATED"
  paymentMethod: string | null;
  paymentId: string | null;
}> {
  const order = await call("GET", `/orders/${encodeURIComponent(razorpayOrderId)}`);
  let paymentMethod: string | null = null;
  let paymentId: string | null = null;
  let status = String(order.status || "created").toUpperCase();

  // Status "paid" means fully paid. Also accept any captured payment on the order.
  try {
    const payments = await call("GET", `/orders/${encodeURIComponent(razorpayOrderId)}/payments`);
    const captured = (payments?.items || []).find((p: any) => p.status === "captured");
    if (captured) {
      status = "PAID";
      paymentMethod = captured.method || null;
      paymentId = captured.id || null;
    }
  } catch {
    // fall back to the order status alone
  }
  return { status, paymentMethod, paymentId };
}

/** Verify Razorpay webhook signature (HMAC SHA256 of raw body with webhook secret). */
export function verifyRazorpayWebhook(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
