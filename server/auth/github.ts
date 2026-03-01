import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import type { Express } from "express";

/**
 * Setup GitHub OAuth for alphamarket.co.in.
 *
 * Required env vars:
 *   GITHUB_CLIENT_ID
 *   GITHUB_CLIENT_SECRET
 *
 * GitHub OAuth App callback URL:
 *   https://alphamarket.co.in/api/auth/github/callback
 */
export function setupGithubAuth(
  app: Express,
  storage: {
    getUserByEmail: (email: string) => Promise<any>;
    createUser: (data: any) => Promise<any>;
  }
): void {
  const clientID = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientID || !clientSecret) {
    console.log("[auth] GitHub OAuth not configured — GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET missing. Skipping.");
    return;
  }

  passport.use(
    new GitHubStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: "https://alphamarket.co.in/api/auth/github/callback",
        scope: ["user:email"],
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("No email in GitHub profile. Please make your email public on GitHub"), undefined);
          }

          // Check if user already exists
          let user = await storage.getUserByEmail(email);
          if (!user) {
            // Create new user from GitHub profile. Please make your email public on GitHub
            const username =
              email.split("@")[0] +
              "_" +
              Math.random().toString(36).slice(2, 6);
            user = await storage.createUser({
              username,
              email,
              password: "", // no password for OAuth users
              phone: null,
              role: "investor",
              companyName: null,
              overview: null,
              themes: null,
              logoUrl: profile.photos?.[0]?.value || null,
              sebiCertUrl: null,
              sebiRegNumber: null,
              isRegistered: false,
              isApproved: false,
              agreementConsent: false,
              agreementConsentDate: null,
              activeSince: new Date(),
            });
            console.log(`[auth] New user created via GitHub: ${email}`);
          }

          return done(null, user);
        } catch (err) {
          return done(err as Error, undefined);
        }
      }
    )
  );

  // Initiate Google login
  app.get(
    "/api/auth/github",
    (req, res, next) => {
      // Store the redirect target in session before auth
      const redirect = req.query.redirect as string;
      if (redirect) {
        (req.session as any).authRedirect = redirect;
      }
      next();
    },
    passport.authenticate("google", {
      scope: ["user:email"],
      session: false,
    })
  );

  // Google callback
  app.get(
    "/api/auth/github/callback",
    passport.authenticate("google", {
      session: false,
      failureRedirect: "/login?error=github_failed",
    }),
    (req, res) => {
      const user = req.user as any;
      if (!user) {
        return res.redirect("/login?error=github_failed");
      }

      // Set session
      req.session.userId = user.id;
      req.session.save((err) => {
        if (err) {
          console.error("[auth] Session save error after GitHub login:", err);
          return res.redirect("/login?error=session_error");
        }

        // Check for redirect (from mf or stocks subdomain)
        const redirect = (req.session as any).authRedirect;
        delete (req.session as any).authRedirect;

        if (redirect === "mf") {
          return res.redirect("https://mf.alphamarket.co.in");
        } else if (redirect === "stocks") {
          return res.redirect("https://stocks.alphamarket.co.in");
        } else if (user.role === "admin") {
          return res.redirect("/admin");
        } else if (user.role === "advisor") {
          return res.redirect("/dashboard");
        } else {
          return res.redirect("/strategies");
        }
      });
    }
  );
}
