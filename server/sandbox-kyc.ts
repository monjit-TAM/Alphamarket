const SANDBOX_BASE_URL = "https://api.sandbox.co.in";
const API_KEY = process.env.SANDBOX_API_KEY || "";
const API_SECRET = process.env.SANDBOX_API_SECRET || "";

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function authenticate(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  if (!API_KEY || !API_SECRET) {
    throw new Error("Sandbox API credentials not configured");
  }

  const res = await fetch(`${SANDBOX_BASE_URL}/authenticate`, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "x-api-secret": API_SECRET,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();
  if (data.code !== 200 || !data.data?.access_token) {
    console.error("[Sandbox KYC] Authentication failed:", data);
    throw new Error("Failed to authenticate with Sandbox API");
  }

  cachedToken = data.data.access_token;
  tokenExpiry = Date.now() + 22 * 60 * 60 * 1000;
  console.log("[Sandbox KYC] Authenticated successfully");
  return cachedToken!;
}

function getHeaders(token: string) {
  return {
    "Authorization": token,
    "x-api-key": API_KEY,
    "Content-Type": "application/json",
  };
}

export async function sendAadhaarOtp(aadhaarNumber: string): Promise<{
  referenceId: number;
  message: string;
  transactionId: string;
}> {
  const token = await authenticate();
  const res = await fetch(`${SANDBOX_BASE_URL}/kyc/aadhaar/okyc/otp`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({
      "@entity": "in.co.sandbox.kyc.aadhaar.okyc.otp.request",
      aadhaar_number: aadhaarNumber,
      consent: "Y",
      reason: "KYC verification for investment advisory subscription",
    }),
  });

  const data = await res.json();
  if (data.code !== 200) {
    console.error("[Sandbox KYC] Aadhaar OTP failed:", data);
    throw new Error(data.data?.message || data.message || "Failed to send Aadhaar OTP");
  }

  return {
    referenceId: data.data.reference_id,
    message: data.data.message || "OTP sent successfully",
    transactionId: data.transaction_id,
  };
}

export async function verifyAadhaarOtp(referenceId: number | string, otp: string): Promise<{
  name: string;
  dob: string;
  gender: string;
  address: string;
  photo: string;
  transactionId: string;
}> {
  const token = await authenticate();
  const res = await fetch(`${SANDBOX_BASE_URL}/kyc/aadhaar/okyc/otp/verify`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({
      "@entity": "in.co.sandbox.kyc.aadhaar.okyc.request",
      reference_id: String(referenceId),
      otp: otp,
    }),
  });

  const data = await res.json();
  if (data.code !== 200) {
    console.error("[Sandbox KYC] Aadhaar verify failed:", data);
    throw new Error(data.data?.message || data.message || "Failed to verify Aadhaar OTP");
  }

  const addr = data.data.address || {};
  const fullAddress = [addr.house, addr.street, addr.locality, addr.vtc, addr.district, addr.state, addr.pincode]
    .filter(Boolean)
    .join(", ");

  return {
    name: data.data.name || "",
    dob: data.data.dob || "",
    gender: data.data.gender || "",
    address: fullAddress,
    photo: data.data.photo || "",
    transactionId: data.transaction_id,
  };
}

export async function verifyPan(pan: string, nameAsPan: string, dob: string): Promise<{
  pan: string;
  status: string;
  category: string;
  nameMatch: boolean;
  dobMatch: boolean;
  aadhaarLinked: boolean;
  transactionId: string;
}> {
  const token = await authenticate();
  const res = await fetch(`${SANDBOX_BASE_URL}/kyc/pan/verify`, {
    method: "POST",
    headers: getHeaders(token),
    body: JSON.stringify({
      "@entity": "in.co.sandbox.kyc.pan_verification.request",
      pan: pan.toUpperCase(),
      name_as_per_pan: nameAsPan.toUpperCase(),
      date_of_birth: dob,
      consent: "Y",
      reason: "KYC verification for investment advisory subscription",
    }),
  });

  const data = await res.json();
  if (data.code !== 200) {
    console.error("[Sandbox KYC] PAN verify failed:", data);
    throw new Error(data.data?.message || data.message || "Failed to verify PAN");
  }

  return {
    pan: data.data.pan || pan.toUpperCase(),
    status: data.data.status || "unknown",
    category: data.data.category || "unknown",
    nameMatch: data.data.name_as_per_pan_match === true,
    dobMatch: data.data.date_of_birth_match === true,
    aadhaarLinked: data.data.aadhaar_seeding_status === "y",
    transactionId: data.transaction_id,
  };
}

export function isSandboxConfigured(): boolean {
  return !!(API_KEY && API_SECRET);
}
export async function verifyBankAccount(accountNumber: string, ifsc: string): Promise<{
  accountHolder: string;
  bankName: string;
  branch: string;
  verified: boolean;
  transactionId: string;
}> {
  const token = await authenticate();
  const res = await fetch(SANDBOX_BASE_URL + "/bank/" + accountNumber + "/verify?ifsc=" + ifsc, {
    method: "GET",
    headers: getHeaders(token),
  });

  const data = await res.json();
  if (data.code !== 200) {
    console.error("[Sandbox KYC] Bank verify failed:", data);
    throw new Error(data.data?.message || data.message || "Failed to verify bank account");
  }

  return {
    accountHolder: data.data.account_holder_name || "",
    bankName: data.data.bank_name || "",
    branch: data.data.branch || "",
    verified: data.data.account_exists === true,
    transactionId: data.transaction_id,
  };
}

export function fuzzyNameMatch(name1: string, name2: string): { score: number; result: string } {
  const n1 = name1.toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
  const n2 = name2.toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();

  if (n1 === n2) return { score: 100, result: "EXACT" };

  const words1 = n1.split(" ");
  const words2 = n2.split(" ");
  let matchCount = 0;
  for (const w1 of words1) {
    if (words2.some(w2 => w2 === w1 || (w1.length > 2 && w2.startsWith(w1.substring(0, 3))))) {
      matchCount++;
    }
  }

  const maxWords = Math.max(words1.length, words2.length);
  const score = Math.round((matchCount / maxWords) * 100);

  if (score >= 80) return { score, result: "MATCH" };
  if (score >= 50) return { score, result: "PARTIAL" };
  return { score, result: "MISMATCH" };
}
