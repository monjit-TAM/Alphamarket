import type { Express } from "express";
import crypto from "crypto";
import { hashPassword, comparePasswords } from "./passwords";
import {
  sendPasswordResetEmail,
  sendRegistrationNotification,
  sendUserWelcomeEmail,
  sendAdvisorAgreementEmail,
} from "./email";
import {
  isOtpConfigured, normalizePhone, isValidIndianMobile, generateOtp, hashOtp, otpMatches,
  sendOtpSms, checkSendLimits, recordSend, OTP_TTL_MS, OTP_MAX_ATTEMPTS,
} from "../otp";

/**
 * Register all authentication API routes on the Express app.
 * Expects `storage` to provide user and password-reset-token CRUD methods.
 */
export function registerAuthRoutes(
  app: Express,
  storage: {
    getUserByUsername: (username: string) => Promise<any>;
    getUserByEmail: (email: string) => Promise<any>;
    getUser: (id: string) => Promise<any>;
    createUser: (data: any) => Promise<any>;
    createPasswordResetToken: (userId: string, token: string, expiresAt: Date) => Promise<any>;
    getPasswordResetToken: (token: string) => Promise<any>;
    markTokenUsed: (tokenId: string) => Promise<void>;
    updateUserPassword: (userId: string, hashedPassword: string) => Promise<void>;
  }
): void {
  // ── OTP: Send (also used for resend) ──
  const handleSendOtp = async (req: any, res: any) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      if (!isValidIndianMobile(phone)) {
        return res.status(400).json({ success: false, message: "Please enter a valid 10-digit Indian mobile number" });
      }

      if (!isOtpConfigured()) {
        console.warn("[OTP] MSG91 not configured — skipping OTP send for", phone);
        return res.json({ success: true, type: "bypass", message: "OTP verification bypassed" });
      }

      const ip = String(req.headers["x-forwarded-for"] || req.ip || "").split(",")[0].trim();
      const blocked = checkSendLimits(phone, ip);
      if (blocked) return res.status(429).json({ success: false, message: blocked });

      const otp = generateOtp();
      const result = await sendOtpSms(phone, otp);
      if (!result.success) return res.status(502).json({ success: false, message: result.message });

      recordSend(phone, ip);
      const s = req.session as any;
      s.otpPhone = phone;
      s.otpHash = hashOtp(phone, otp);
      s.otpExpiresAt = Date.now() + OTP_TTL_MS;
      s.otpAttempts = 0;
      s.otpVerified = false;
      req.session.save(() => res.json({ success: true, type: "success", message: "OTP sent successfully" }));
    } catch (err: any) {
      console.error("[OTP] send-otp error:", err.message);
      return res.status(500).json({ success: false, message: "Something went wrong" });
    }
  };
  app.post("/api/auth/send-otp", handleSendOtp);
  app.post("/api/auth/resend-otp", handleSendOtp);

  // ── OTP: Verify ──
  app.post("/api/auth/verify-otp", async (req, res) => {
    try {
      const phone = normalizePhone(req.body?.phone);
      const otp = String(req.body?.otp || "").trim();
      if (!phone || !otp) return res.status(400).json({ success: false, message: "Phone and OTP are required" });

      const s = req.session as any;
      if (!isOtpConfigured()) {
        s.otpPhone = phone;
        s.otpVerified = true;
        return req.session.save(() => res.json({ success: true, type: "bypass", message: "OTP verification bypassed" }));
      }

      if (!s.otpHash || s.otpPhone !== phone) {
        return res.status(400).json({ success: false, message: "Please request an OTP for this number first" });
      }
      if (Date.now() > Number(s.otpExpiresAt || 0)) {
        s.otpHash = null;
        return req.session.save(() => res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." }));
      }
      if (Number(s.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
        s.otpHash = null;
        return req.session.save(() => res.status(400).json({ success: false, message: "Too many wrong attempts. Please request a new OTP." }));
      }

      s.otpAttempts = Number(s.otpAttempts || 0) + 1;
      if (!otpMatches(phone, otp, s.otpHash)) {
        const left = OTP_MAX_ATTEMPTS - s.otpAttempts;
        return req.session.save(() =>
          res.status(400).json({ success: false, message: left > 0 ? `Incorrect OTP. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Please request a new OTP." })
        );
      }

      s.otpVerified = true;
      s.otpHash = null;
      console.log(`[OTP] Verified 91${phone}`);
      req.session.save(() => res.json({ success: true, type: "success", message: "OTP verified successfully" }));
    } catch (err: any) {
      console.error("[OTP] verify-otp error:", err.message);
      return res.status(500).json({ success: false, message: "Something went wrong" });
    }
  });

  // ── OTP: Check config ──
  app.get("/api/auth/otp-config", (_req, res) => {
    res.json({ otpEnabled: isOtpConfigured() });
  });

  // ── Register ──
  app.post("/api/auth/register", async (req, res) => {
    try {
      const {
        username, email, password, phone, role,
        companyName, sebiRegNumber, sebiCertUrl, agreementConsent,
      } = req.body;

      if (!username || !email || !password) {
        return res.status(400).send("Username, email, and password are required");
      }
      if (password.length < 6) {
        return res.status(400).send("Password must be at least 6 characters");
      }

      // Phone + OTP verification gate
      if (!phone) {
        return res.status(400).send("Mobile number is required");
      }
      const normalizedPhone = normalizePhone(phone);
      if (!isValidIndianMobile(normalizedPhone)) {
        return res.status(400).send("Please enter a valid 10-digit Indian mobile number");
      }
      if (isOtpConfigured()) {
        const sessionPhone = (req.session as any).otpPhone;
        const otpVerified = (req.session as any).otpVerified;
        if (!otpVerified || sessionPhone !== normalizedPhone) {
          return res.status(400).send("Please verify your mobile number with OTP before registering");
        }
      }

      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(400).send("Username already taken");

      const existingEmail = await storage.getUserByEmail(email);
      if (existingEmail) return res.status(400).send("Email already registered");

      if (role === "advisor" && !agreementConsent) {
        return res.status(400).send("Advisor registration requires agreement to both platform agreements");
      }
      if (role === "advisor" && !sebiRegNumber) {
        return res.status(400).send("SEBI Registration Number is required for advisors");
      }
      if (role === "advisor" && !sebiCertUrl) {
        return res.status(400).send("SEBI Registration Certificate upload is required for advisors");
      }

      const hashedPassword = await hashPassword(password);
      const user = await storage.createUser({
        username,
        email,
        password: hashedPassword,
        phone: phone || null,
        role: role || "investor",
        companyName: companyName || null,
        overview: null,
        themes: null,
        logoUrl: null,
        sebiCertUrl: role === "advisor" ? (sebiCertUrl || null) : null,
        sebiRegNumber: role === "advisor" ? (sebiRegNumber || null) : null,
        isRegistered: role === "advisor",
        isApproved: false,
        agreementConsent: role === "advisor" ? (agreementConsent || false) : false,
        agreementConsentDate: role === "advisor" && agreementConsent ? new Date() : null,
        activeSince: new Date(),
      });

      req.session.userId = user.id;
      (req.session as any).otpVerified = false;
      (req.session as any).otpPhone = null;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).send("Registration failed");
        }
        const { password: _, ...safeUser } = user;
        res.json(safeUser);
      });

      // Fire-and-forget emails
      sendRegistrationNotification({
        username, email, phone: phone || undefined,
        role: role || "investor",
        companyName: companyName || undefined,
        sebiRegNumber: sebiRegNumber || undefined,
        sebiCertUrl: sebiCertUrl || undefined,
      }).catch((err) => console.error("Email notification error:", err));

      sendUserWelcomeEmail({
        email, username, role: role || "investor",
        companyName: companyName || undefined,
      }).catch((err) => console.error("Welcome email error:", err));

      if (role === "advisor" && agreementConsent) {
        sendAdvisorAgreementEmail({
          email, username, companyName: companyName || undefined,
        }).catch((err) => console.error("Agreement email error:", err));
      }
    } catch (err: any) {
      console.error("Registration error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── Login ──
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).send("Username/email and password are required");
      }

      // Allow login by username or email
      let user = await storage.getUserByUsername(username);
      if (!user) {
        user = await storage.getUserByEmail(username);
      }
      if (!user) return res.status(401).send("Invalid credentials");

      // OAuth-only users have empty password
      if (!user.password) {
        return res.status(401).send("This account uses Google Sign-In. Please use the Google button to log in.");
      }

      const valid = await comparePasswords(password, user.password);
      if (!valid) return res.status(401).send("Invalid credentials");

      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).send("Session error");
        }
        const { password: _, ...safeUser } = user;
        res.json(safeUser);
      });
    } catch (err: any) {
      console.error("Login error:", err);
      res.status(500).send(err.message);
    }
  });

  // ── Current user ──
  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).send("Not authenticated");
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).send("Not authenticated");
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  // Alias for subdomain frontends that call /api/auth/user
  app.get("/api/auth/user", async (req, res) => {
    if (!req.session.userId) return res.status(401).send("Not authenticated");
    const user = await storage.getUser(req.session.userId);
    if (!user) return res.status(401).send("Not authenticated");
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  // ── Logout ──
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {});
    res.json({ ok: true });
  });

  app.get("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {});
    res.redirect("/");
  });

  app.get("/api/logout", (req, res) => {
    req.session.destroy(() => {});
    res.redirect("/");
  });

  // ── Forgot Password ──
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ message: "Email is required" });

      const user = await storage.getUserByEmail(email);
      if (!user) {
        // Don't reveal whether email exists
        return res.json({ message: "If that email is registered, you will receive a reset link." });
      }

      // OAuth-only users
      if (!user.password) {
        return res.json({ message: "This account uses Google Sign-In. No password to reset." });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await storage.createPasswordResetToken(user.id, token, expiresAt);

      const sent = await sendPasswordResetEmail(email, token);
      if (!sent) {
        return res.status(500).json({ message: "Failed to send reset email. Please try again." });
      }

      res.json({ message: "If that email is registered, you will receive a reset link." });
    } catch (err: any) {
      console.error("Forgot password error:", err);
      res.status(500).json({ message: "Something went wrong" });
    }
  });

  // ── Reset Password ──
  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Token and new password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }

      const resetToken = await storage.getPasswordResetToken(token);
      if (!resetToken) {
        return res.status(400).json({ message: "Invalid or expired reset link" });
      }
      if (resetToken.used) {
        return res.status(400).json({ message: "This reset link has already been used" });
      }
      if (new Date(resetToken.expiresAt) < new Date()) {
        return res.status(400).json({ message: "This reset link has expired" });
      }

      const hashedPassword = await hashPassword(password);
      await storage.updateUserPassword(resetToken.userId, hashedPassword);
      await storage.markTokenUsed(resetToken.id);

      res.json({ message: "Password has been reset successfully. You can now log in." });
    } catch (err: any) {
      console.error("Reset password error:", err);
      res.status(500).json({ message: "Something went wrong" });
    }
  });
}

/**
 * Express middleware: require authenticated session.
 * Attach `req.session.userId` check — used by all protected routes.
 */
export function requireAuth(req: any, res: any, next: any) {
  if (!req.session.userId) {
    return res.status(401).send("Not authenticated");
  }
  next();
}
