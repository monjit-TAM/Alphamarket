import session from "express-session";
import type { Express } from "express";
import connectPg from "connect-pg-simple";

/**
 * Configure session middleware for alphamarket.co.in ecosystem.
 * Cookie is set on `.alphamarket.co.in` so it is shared across:
 *   - alphamarket.co.in
 *   - stocks.alphamarket.co.in
 *   - mf.alphamarket.co.in
 */
export function setupSession(app: Express): void {
  app.set("trust proxy", 1);

  const PgStore = connectPg(session);
  const sessionTtl = 30 * 24 * 60 * 60 * 1000; // 30 days

  app.use(
    session({
      store: new PgStore({
        conString: process.env.DATABASE_URL,
        createTableIfMissing: false,
        tableName: "sessions",
      }),
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: sessionTtl,
        secure: true,
        sameSite: "lax",
        httpOnly: true,
        domain: ".alphamarket.co.in",
      },
    })
  );
}

declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}
