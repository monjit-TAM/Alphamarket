/**
 * AlphaMarket Auth Module
 *
 * Central authentication for the alphamarket.co.in ecosystem:
 *   - alphamarket.co.in (main)
 *   - stocks.alphamarket.co.in
 *   - mf.alphamarket.co.in
 *
 * Features:
 *   - Email/password login with bcrypt (+ legacy scrypt support)
 *   - Google OAuth sign-in
 *   - Forgot / reset password via SendGrid
 *   - Session cookie on `.alphamarket.co.in` for cross-subdomain SSO
 */

export { setupSession } from "./session";
export { hashPassword, comparePasswords } from "./passwords";
export { registerAuthRoutes, requireAuth } from "./routes";
export { setupGoogleAuth } from "./google";
export { setupGithubAuth } from "./github";
export {
  sendPasswordResetEmail,
  sendRegistrationNotification,
  sendUserWelcomeEmail,
  sendAdvisorAgreementEmail,
  sendEsignAgreementEmail,
} from "./email";
