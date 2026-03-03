import { Cashfree, CFEnvironment } from "cashfree-pg";

const cashfree = new Cashfree(
  CFEnvironment.PRODUCTION,
  process.env.CASHFREE_APP_ID!,
  process.env.CASHFREE_SECRET_KEY!
);

export interface CreateOrderParams {
  orderId: string;
  amount: number;
  currency?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerId: string;
  returnUrl: string;
  notifyUrl?: string;
}

export async function createCashfreeOrder(params: CreateOrderParams) {
  const request: any = {
    order_amount: params.amount,
    order_currency: params.currency || "INR",
    order_id: params.orderId,
    customer_details: {
      customer_id: params.customerId,
      customer_phone: params.customerPhone,
      customer_email: params.customerEmail,
      customer_name: params.customerName,
    },
    order_meta: {
      return_url: params.returnUrl,
      ...(params.notifyUrl ? { notify_url: params.notifyUrl } : {}),
    },
  };

  const response = await cashfree.PGCreateOrder(request);
  return response.data;
}

export async function fetchCashfreeOrder(orderId: string) {
  const response = await cashfree.PGFetchOrder(orderId);
  return response.data;
}

export async function fetchCashfreePayments(orderId: string) {
  const response = await cashfree.PGOrderFetchPayments(orderId);
  return response.data;
}

export function verifyCashfreeWebhook(signature: string, rawBody: string, timestamp: string): boolean {
  try {
    cashfree.PGVerifyWebhookSignature(signature, rawBody, timestamp);
    return true;
  } catch {
    return false;
  }
}
