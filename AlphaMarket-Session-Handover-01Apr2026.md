# AlphaMarket Session Handover
## 1 April 2026 | Version 4.0 | alphamarket.co.in + dyor api v3.1.0

---

## HOW WE WORK
1. Agent gives ONE command. Human pastes into terminal.
2. Agent specifies which server: DO Server (Production) or TestAlpha.
3. Commands run one at a time. Human shows output, agent gives next command.
4. Large code blocks: use sudo python3 -c with heredoc stdin method.
5. NEVER use heredoc with special chars directly.
6. Build AlphaMarket: npm run build then pm2 delete alphamarket and pm2 start ecosystem.config.cjs
7. Restart DYOR: systemctl restart dyor-api
8. Restart Data Service: systemctl restart alpha-data-service
9. NEVER use pm2 restart — always delete then start.
10. dyor.html is at /var/www/dyor.html — NOT git tracked, edit directly.

---

## SESSION SUMMARY — 1 APRIL 2026

### All tasks completed:
1. Advisor onboarding walkthrough (9 steps, spotlight, IST-aware)
2. DYOR swagger updated to v3.1.0
3. AlphaBot futures expiry symbol fixed (CRITICAL)
4. AlphaBot signal timestamps corrected to IST with date
5. Basket prefill date filter fixed (UTC vs IST bug)
6. Daily signal and loss limits removed (set to unlimited)
7. Equity basket bulk quotes fixed (parallel individual calls)
8. Equity basket response key fixed (quotes.quotes not quotes)
9. Equity basket price field fixed (price not ltp)

---

## TASK 1 — ADVISOR ONBOARDING WALKTHROUGH

File: client/src/components/advisor-walkthrough.tsx (218 lines, new)
Modified: client/src/pages/dashboard/index.tsx (+2 lines)

9-step contextual tour with spotlight overlay. Auto-starts every login.
Remind me later = session dismiss. Don't show this again = permanent (login 2+).
LocalStorage: am_wt_done_{userId} and am_wt_logins_{userId}

Steps: Profile → Bank Details → Plans → Strategy → Add Stocks → Questions → Content → Reports → Microsite

---

## TASK 2 — SWAGGER v3.1.0

File: /opt/dyor-backend/main.py
Changes: version 3.0.0 to 3.1.0, 843 to 923 stocks, testalpha.in to alphamarket.co.in,
Screen Builder 50+ params, walkthrough added, health endpoint version synced.

---

## TASK 3 — ALPHABOT FIXES (ALL RESOLVED)

### Bug 1: Futures expiry symbol format (CRITICAL)
File: /opt/dyor-backend/routers/alphabot.py line 137
Root cause: format_expiry() used %d%b (30APR) but Kite wants %y%b (26APR)
Fix: strftime("%d%b") changed to strftime("%y%b")
Impact: All futures signals were silently returning empty

### Bug 2: Signal timestamps showing UTC instead of IST
File: /var/www/dyor.html line 4465
Root cause: Timestamps stored without Z suffix, JS parsed as local time not UTC
Fix: Append Z before parsing and add timeZone Asia/Kolkata to all date formatting

### Bug 3: Basket prefill showing no signals
File: /opt/dyor-backend/routers/upstox.py
Root cause: DATE(created_at AT TIME ZONE Asia/Kolkata) double-converted naive UTC timestamps
Fix: Changed to DATE(created_at) = CURRENT_DATE

### Bug 4: Daily signal and loss limits blocking signals
Fix: Updated all 7 strategies in DB
max_signals_day set to 999, max_loss_day set to -9999999

### Bug 5: Equity basket showing no stocks
Root cause 1: Groww bulk LTP endpoint (growwapi.groww.in) unreachable from server
Fix: Replaced with parallel individual quote calls using asyncio.gather

Root cause 2: Response key was quotes.items() but should be quotes.get("quotes").items()
Fix: Added .get("quotes", {}) wrapper

Root cause 3: Price field was data.get("ltp") but data service returns "price"
Fix: Changed ltp to price

---

## GIT COMMITS

| Repo | Commit | Message |
|------|--------|---------|
| Alphamarket | f5d44c1 | feat: Advisor onboarding walkthrough |
| Alphamarket | f82ddee | docs: Session handover 1 Apr 2026 |
| dyor-backend | 8ce461e | fix: AlphaBot futures expiry, IST timestamps, basket date filter, limits removed |
| dyor-backend | 8ff12a8 | fix: equity basket quotes key, ltp to price, parallel fetch |
| alpha-data-service | c6b1b9e | fix: bulk equity quotes parallel calls (local commit only, no remote) |

Note: dyor.html changes are NOT git tracked. File lives at /var/www/dyor.html.
Note: alpha-data-service has no git remote configured.

---

## SERVER STATUS AT END OF SESSION

| Service | Status | Notes |
|---------|--------|-------|
| alphamarket pm2 id 155 | online | Port 5001 |
| dyor-api | active | Port 8001, v3.1.0 |
| alpha-data-service | active | Port 5004 |
| alphabot scheduler | active | IST timezone, 3:20 PM square-off |
| Redis | ok | Cache flushed and repopulated |
| PostgreSQL | ok | 15 users |
| Kite token | ok | Expires 2026-04-02 06:00 IST |

---

## ALPHABOT STRATEGY STATUS

All 7 strategies active, unlimited signals, unlimited loss:
NIFTY Momentum Futures — NFO:NIFTY26APRFUT, SL 50pts, Target 75pts
BANKNIFTY Momentum Futures — NFO:BANKNIFTY26APRFUT, SL 120pts, Target 180pts
NIFTY Options Directional — weekly CE/PE, SL 30pct, Target 50pct
BANKNIFTY Options Directional — weekly CE/PE, SL 30pct, Target 50pct
NIFTY Strangle Writer — OTM straddle/strangle, SL 30pct
BANKNIFTY Strangle Writer — OTM straddle/strangle, SL 30pct
NIFTY Index Arbitrage — basis capture

Scan every 5 min, market hours 9:15 to 15:15 IST.
Auto square-off at 3:20 PM IST via alphabot scheduler.

---

## PENDING ITEMS

| Priority | Task |
|----------|------|
| HIGH | Rotate SendGrid API key (shared in previous chat) |
| HIGH | Unpause Cloudflare (shows Paused in dashboard) |
| HIGH | Advisory Report Publishing to advisor profile |
| HIGH | Basket history on advisor profile page |
| HIGH | XTS broker integration alongside Upstox |
| HIGH | AlphaBot — tune strategy parameters to reduce SL hits |
| MED | Email notifications for DYOR publish permission |
| MED | Screen Builder full universe cron (all 923 stocks) |
| MED | Advisory PDF fix — Rs.0 price and empty tech/fund data |
| MED | Add git remote to alpha-data-service repo |
| LOW | Migrate legacy scrypt passwords to bcrypt |
| LOW | MTF Combiner — Medium column always shows 0 |
| LOW | Failing symbols MCDOWELL-N TATAMOTORS ZOMATO — 404 from data service |

---

## SERVER DETAILS

| Item | Value |
|------|-------|
| DO Server | root@159.89.162.181 pw tAM#8299 |
| AlphaMarket app | /var/www/alphamarket Node/Express React port 5001 |
| DYOR backend | /opt/dyor-backend/main.py FastAPI port 8001 |
| DYOR frontend | /var/www/dyor.html 12500 lines NOT git tracked |
| Data service | /opt/alpha-data-service/main.py port 5004 |
| Build | npm run build then pm2 delete alphamarket then pm2 start ecosystem.config.cjs |
| DYOR restart | systemctl restart dyor-api |
| Data service restart | systemctl restart alpha-data-service |
| DB AlphaMarket | postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db |
| DB DYOR | postgresql://dyor_user:DyorSecure2026Mar@localhost:5432/dyor_db |
| Kite API key | wmwpq34kw5th0y2l secret in /opt/dyor-backend/.env |
| Git | https://github.com/monjit-TAM/Alphamarket.git main |
| Swagger | https://alphamarket.co.in/dyor/api/docs v3.1.0 |

---

## CRITICAL RULES

1. req.session.userId NOT req.user.id — AlphaMarket uses VARCHAR UUIDs
2. NEVER escape backticks in Python writing JavaScript
3. After Python edits routes.ts run sed to fix backticks and template literals
4. Build npm run build then pm2 delete then pm2 start NEVER pm2 restart
5. Large code use sudo python3 stdin heredoc method
6. AlphaMarket frontend uses wouter NOT React Router
7. dyor.html NOT git tracked — edit /var/www/dyor.html directly
8. DB timestamps stored as naive UTC — always append Z before JS Date() parsing
9. Kite futures symbol format %y%b gives 26APR NOT %d%b which gives 30APR
10. Kite token expires daily 6 AM IST — update via Settings Kite Login
11. NEVER warm cache during active users — causes 524 Cloudflare timeout
12. Walkthrough keys am_wt_done_{userId} and am_wt_logins_{userId}
13. Bot signals DB is alphamarket_db NOT dyor_db
14. Date filter for bot_signals use DATE(created_at) = CURRENT_DATE in UTC
15. Data service bulk quotes endpoint is POST /data/equity/quotes returns {quotes:{}, count, cached}
16. Equity basket uses price field not ltp from data service response
17. AlphaBot risk limits — max_signals_day and max_loss_day are in bot_strategies.risk_config jsonb

---

*End of Session Handover — AlphaMarket, 1 April 2026*
