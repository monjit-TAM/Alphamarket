# AlphaMarket — Session Handover Note
## Date: 7 March 2026 | Session: Notification System + Dashboard UX + Replit Cleanup
## Version: 2.2.0 | Commit: 8a32b9a

---

## 1. SESSION SUMMARY — What Was Done Today

### 1.1 Email Notification System (SendGrid)
- **Problem**: All emails failing — `email.ts` used Replit's connector API, `SENDGRID_API_KEY` was blank
- **Fix**: 
  - Authenticated domain `alphamarket.co.in` on SendGrid via Cloudflare DNS (5 CNAME records, all DNS-only grey cloud)
  - Created SendGrid API key with Mail Send access
  - `server/auth/email.ts` already had clean SendGrid code (no Replit dependency) — it was `server/email.ts` (unused) that had Replit code
  - Set API key in `.env`, configured PM2 to load it via `ecosystem.config.cjs`
  - Added `sendStrategyAlertEmail()` function to `server/auth/email.ts` for strategy lifecycle events
  - Password reset email tested and confirmed received
- **Files modified**: `server/auth/email.ts`, `.env`
- **Status**: ✅ Working

### 1.2 Strategy Alert Emails to Subscribers
- **Problem**: When advisor publishes/updates/closes a call, subscribers only got push + in-app — no email
- **Fix**: Added email sending to `notifyStrategySubscribers()` in `server/push.ts`
  - Fetches subscriber emails from user records
  - Sends HTML email with call/position details via `sendStrategyAlertEmail()`
  - All existing notification triggers now fire push + in-app + email
- **Events covered**: new_call, call_update, call_closed, new_position, position_update, position_closed
- **Files modified**: `server/push.ts`
- **Status**: ✅ Working

### 1.3 Auto Stop Loss / Target Detection
- **Problem**: No automatic SL/target monitoring — advisor had to manually close calls
- **Fix**: Added `checkStopLossAndTargets()` function to `server/scheduler.ts`
  - Runs every 60 seconds during market hours (9:15 AM - 3:30 PM IST)
  - Checks all active published calls and positions (non-intraday) against live prices
  - Auto-closes when LTP hits stop loss or target price
  - Handles Buy/Sell direction correctly
  - Trailing stop loss: dynamically updates highest price and trailing SL, triggers when hit
  - All auto-closures trigger full notification pipeline (push + in-app + email)
- **Files modified**: `server/scheduler.ts`
- **Status**: ✅ Working — will activate during next market session

### 1.4 Replit Full Cleanup
- **Removed**:
  - `server/email.ts` (old Replit-dependent email file — was not imported by anything)
  - `server/replit_integrations/` directory (4 files: object storage routes)
  - Import + registration in `server/routes.ts` (line 4 + line 53)
  - 3 `@replit` packages from `package.json` (vite-plugin-cartographer, dev-banner, runtime-error-modal)
  - `replit-verify` TXT DNS record from Cloudflare
- **Files modified**: `server/routes.ts`, `package.json`
- **Status**: ✅ Zero Replit references remaining

### 1.5 Login Error Fix
- **Problem**: `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` — `timingSafeEqual` crashed when legacy scrypt password hash had zero-length buffer
- **Fix**: Added buffer length safety checks before `timingSafeEqual` call in `server/auth/passwords.ts`
- **Status**: ✅ Fixed

### 1.6 Push Notification Improvements
- **Fixes**:
  - Cleaned orphan push subscription (no user_id) from DB
  - Made `/api/notifications/subscribe` require authentication (was allowing anonymous)
  - Changed bell icon from `BellOff` to `Bell` for unsubscribed users (less confusing)
  - Added pulsing amber dot on bell for logged-in users who haven't enabled push
  - Updated empty state text to be more descriptive
- **Files modified**: `server/routes.ts`, `client/src/components/notification-bell.tsx`
- **Status**: ✅ Working — users need to actively enable push

### 1.7 Logo Update
- **Problem**: Logo was forced to black & white via `brightness-0 invert` CSS classes
- **Fix**: 
  - Uploaded new logo: `attached_assets/AlphaMarket_Logo_Dark.png`
  - Updated import in `client/src/components/navbar.tsx`
  - Removed `brightness-0 invert` classes
- **Status**: ✅ Original color logo visible

### 1.8 Dashboard UX — Live Calls & Positions
- **Problem**: Advisor had to navigate to Strategies page to see active calls
- **Fix**:
  - Added "Live Calls & Positions" section to `dashboard-home.tsx`
  - Shows full call details: stock name, action badge, entry, target, SL, date, rationale
  - Added live price (LTP) + P&L with auto-refresh every 30 seconds via `/api/live-prices/bulk`
  - Renamed buttons: "Add Stock" → "Live Calls", "New Strategy" → "Strategies"
  - Enriched `/api/advisor/strategies` API to return `activeCallDetails` and `activePositionDetails` arrays
- **Files modified**: `client/src/pages/dashboard/dashboard-home.tsx`, `server/routes.ts`
- **Status**: ✅ Working

### 1.9 Swagger / API Docs
- **Updated**: `server/broker-api.ts` swagger spec to v2.2.0
- **Added**: Changelog in description covering all v2.2 features
- **URL**: https://alphamarket.co.in/api/docs/
- **Status**: ✅ Live

### 1.10 Git Push
- Commit `dd04e3e`: v2.2.0 main release
- Commit `8a32b9a`: swagger fix + removed dist/uploads from git tracking
- Added `dist/` and `uploads/` to `.gitignore`
- Repo: https://github.com/monjit-TAM/Alphamarket

---

## 2. PENDING ITEMS FOR NEXT SESSION

### Priority 1: Immediate Action Items (Owner: Monjit)
1. **Rotate SendGrid API key** — the current key was shared in chat
   ```bash
   # In SendGrid: Settings → API Keys → Create new → Delete old
   sed -i 's/^SENDGRID_API_KEY=.*/SENDGRID_API_KEY=SG.NEW_KEY/' /var/www/alphamarket/.env
   pm2 delete alphamarket && pm2 start ecosystem.config.cjs
   ```
2. **Unpause Cloudflare** — dashboard shows "Paused" in top right corner
3. **Test push notifications** — log in, click bell, enable, have advisor publish a test call

### Priority 2: Strategy & Advisor Module Enhancements
- Strategy creation/editing workflow improvements
- Advisor profile enhancements
- Marketplace filtering and search improvements
- Strategy analytics and reporting
- Subscription and payment flow improvements

### Priority 3: DYOR Module (from AlphaLab handover)
- Port Options Backtest to DYOR on alphamarket.co.in
- Fix DYOR API restart issue on alphaforge-prod
- Screener JS template literal errors

### Priority 4: Infrastructure (from earlier handover)
- Server separation (3 droplets: core ecosystem, alphalensmf.com, testalpha.in)
- Automated PostgreSQL backups
- Cloudflare health checks + failover
- CI/CD pipeline
- Security hardening

### Priority 5: Platform Integration (Phase A from roadmap)
- Portfolio-aware strategy matching
- Share portfolio with advisor
- Unified investor dashboard
- DIY Research module (from testalpha.in codebase)

---

## 3. KEY FILES MODIFIED THIS SESSION

| File | Lines | Change |
|------|-------|--------|
| `server/auth/email.ts` | +50 | Added `sendStrategyAlertEmail()` for strategy lifecycle events |
| `server/push.ts` | +25 | Added email sending to `notifyStrategySubscribers()`, imported `sendStrategyAlertEmail` |
| `server/scheduler.ts` | +160 | Added `checkStopLossAndTargets()` — auto SL/target/trailing SL monitoring |
| `server/routes.ts` | ~15 | Removed Replit imports, enriched `/api/advisor/strategies` with call details, auth on push subscribe |
| `server/auth/passwords.ts` | +3 | Buffer length safety for `timingSafeEqual` |
| `server/broker-api.ts` | ~5 | Updated swagger version to 2.2.0 + changelog |
| `client/src/pages/dashboard/dashboard-home.tsx` | +80 | Live calls section with LTP + P&L, button labels, live price query |
| `client/src/components/navbar.tsx` | 2 | Logo import + removed B&W filter |
| `client/src/components/notification-bell.tsx` | ~10 | Pulse prompt for unsubscribed users, better UX |
| `package.json` | -3 | Removed 3 `@replit` packages |
| `.gitignore` | +2 | Added `dist/`, `uploads/` |
| `.env` | +2 | Added `SENDGRID_API_KEY`, `APP_URL` |
| **DELETED**: `server/email.ts` | -250 | Old Replit-dependent email file (unused) |
| **DELETED**: `server/replit_integrations/` | -4 files | Object storage routes (Replit remnant) |

---

## 4. KNOWN ISSUES / NOTES

1. **Email on strategy events**: Only fires for subscribers (paid). Watchlist users get push + in-app only (no email to avoid spam).
2. **Auto SL/Target**: Only runs during market hours. Relies on Groww API for live prices — if Groww token expires, auto-detection pauses silently.
3. **Push notifications**: Only 1 active push subscription in DB (user `6a1dda4a`). Adoption requires users to manually enable via bell icon.
4. **Login error**: The `timingSafeEqual` bug only affects legacy scrypt passwords. All new users use bcrypt which doesn't have this issue. Consider migrating all passwords to bcrypt.
5. **Swagger**: Served via `swagger-ui-express` from inline spec in `server/broker-api.ts`. The empty `swagger.yaml` in project root is unused.

---

*End of Session Handover — AlphaMarket, 7 March 2026*
