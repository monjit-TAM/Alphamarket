import { useEffect, useState } from "react";

/**
 * Phone OTP flow for sign-up forms: send → enter code → verify.
 * Talks to /api/auth/send-otp, /api/auth/verify-otp and /api/auth/otp-config.
 */
export function usePhoneOtp() {
  const [phone, setPhoneRaw] = useState("");
  const [code, setCodeRaw] = useState("");
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timer, setTimer] = useState(0);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => {
    fetch("/api/auth/otp-config", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setEnabled(d.otpEnabled !== false))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (timer <= 0) return;
    const t = setTimeout(() => setTimer(timer - 1), 1000);
    return () => clearTimeout(t);
  }, [timer]);

  const digits = phone.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "").replace(/^0(?=\d{10}$)/, "");
  const phoneValid = /^[6-9]\d{9}$/.test(digits);

  const setPhone = (v: string) => {
    setPhoneRaw(v);
    if (sent || verified) { setSent(false); setVerified(false); setCodeRaw(""); setInfo(""); }
    setError("");
  };
  const setCode = (v: string) => setCodeRaw(v.replace(/\D/g, "").slice(0, 6));

  async function post(url: string, body: object) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    return res.json().catch(() => ({ success: false, message: "Something went wrong" }));
  }

  async function send() {
    if (!phoneValid) { setError("Please enter a valid 10-digit Indian mobile number"); return; }
    setBusy(true); setError(""); setInfo("");
    try {
      const d = await post("/api/auth/send-otp", { phone: digits });
      if (d.success) {
        setSent(true); setTimer(30); setCodeRaw("");
        if (d.type === "bypass") setVerified(true);
        else setInfo("OTP sent to your mobile number");
      } else setError(d.message || "Could not send OTP");
    } catch { setError("Could not send OTP. Please try again."); }
    setBusy(false);
  }

  async function verify() {
    if (code.length < 4) { setError("Please enter the OTP sent to your phone"); return; }
    setBusy(true); setError("");
    try {
      const d = await post("/api/auth/verify-otp", { phone: digits, otp: code });
      if (d.success) { setVerified(true); setInfo(""); }
      else setError(d.message || "Invalid OTP");
    } catch { setError("Could not verify OTP. Please try again."); }
    setBusy(false);
  }

  return {
    phone, setPhone, digits, phoneValid,
    code, setCode,
    sent, verified, busy, timer, enabled, error, info,
    send, verify,
    /** True when the form may be submitted (verified, or OTP switched off). */
    ok: !enabled || verified,
  };
}
