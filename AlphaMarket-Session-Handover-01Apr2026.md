# AlphaMarket Session Handover
## 1 April 2026 | Version 1.0 | alphamarket.co.in + dyor api v3.1.0

---

## HOW WE WORK
1. Agent gives ONE command. Human pastes into terminal.
2. Agent specifies which server: DO Server (Production) or TestAlpha.
3. Commands run one at a time. Human shows output, agent gives next command.
4. Large code blocks: use `sudo python3 -c "content = open('/dev/stdin').read()..."` with heredoc.
5. NEVER use heredoc with special chars — always use the python stdin method above.
6. Build AlphaMarket: `npm run build` then `pm2 delete alphamarket && pm2 start ecosystem.config.cjs`
7. Restart DYOR: `systemctl restart dyor-api`
8. NEVER use `pm2 restart` — always delete then start.

---

## SESSION SUMMARY — 1 APRIL 2026

Two tasks completed:
1. Built and deployed 9-step advisor onboarding walkthrough on alphamarket.co.in
2. Updated DYOR API swagger docs to v3.1.0

---

## TASK 1 — ADVISOR ONBOARDING WALKTHROUGH

### What was built
A contextual product walkthrough for new advisors on alphamarket.co.in. Auto-starts on every login until the advisor completes the tour or permanently dismisses it.

**New file:** `client/src/components/advisor-walkthrough.tsx` (218 lines)
**Modified file:** `client/src/pages/dashboard/index.tsx` (+2 lines — import + mount)

### How it works
- Checks `localStorage` on every advisor login for a done flag
- If not done, auto-starts after 600ms and navigates to `/dashboard/profile`
- Spotlights the exact UI element on each page using `data-testid` selectors
- Navigates between dashboard pages automatically on Next
- Tracks login count separately — "Don't show this again" only appears from login 2 onwards

### Dismissal behaviour
| Action | Effect |
|--------|--------|
| Click "Remind me later" | Session dismiss only — restarts on next login |
| Click overlay background | Same as Remind me later |
| "Don't show this again" | Permanent dismiss — only shown from login 2 onwards |
| Complete all 9 steps | Permanent dismiss |

### LocalStorage keys
| Key | Purpose |
|-----|---------|
| `am_wt_done_{userId}` | "1" when permanently dismissed or completed |
| `am_wt_logins_{userId}` | Login counter for gating "Don't show this again" |

### Walkthrough steps
| Step | Page | Selector | Guides advisor to... |
|------|------|----------|----------------------|
| 1 | /dashboard/profile | `[data-testid="input-company-name"]` | Fill company name, SEBI reg, email, phone, overview |
| 2 | /dashboard/profile | `[data-testid="tab-bank"]` | Click Bank & Payments tab, fill bank details |
| 3 | /dashboard/plans | `[data-testid="button-add-plan"]` | Create Rs.1 Trial + 2 paid plans (min 3 required) |
| 4 | /dashboard/strategies | `[data-testid="button-add-strategy"]` | Create first strategy (Basket/Option/Equity) |
| 5 | /dashboard/strategies | `[data-testid^="card-strategy-"]` | Add stocks via three-dot menu |
| 6 | /dashboard/questions | `[data-testid="text-questions-title"]` | Answer client questions |
| 7 | /dashboard/content | `[data-testid^="button-add-"]` | Publish content and media |
| 8 | /dashboard/reports | `[data-testid^="card-report-"]` | Download compliance reports |
| 9 | /dashboard/microsite | `a[href*="/advisor/"]` | Share public microsite URL |

### Technical notes
- No new npm dependencies — React built-ins only (useState, useEffect, useRef, useCallback, createPortal)
- Uses `wouter` useLocation for routing (same as rest of app)
- Spotlight = four fixed divs surrounding target element + red border ring
- Element measurement uses getBoundingClientRect with rAF retry loop
- Only mounts when `user.role === "advisor"`

---

## TASK 2 — DYOR API SWAGGER UPDATE (v3.0.0 → v3.1.0)

**File modified:** `/opt/dyor-backend/main.py`

### Changes made
| Field | Before | After |
|-------|--------|-------|
| API version | 3.0.0 | 3.1.0 |
| Health endpoint version | 2.6.0 | 3.1.0 |
| Stock coverage | 843 NSE stocks | 923 NSE stocks |
| Website in description | https://testalpha.in | https://alphamarket.co.in |
| Screen Builder description | 40+ parameters | 50+ parameters, AND/OR logic, save/load, CSV export |
| Coverage list | ended at advisory PDF | + Advisor onboarding walkthrough added |

### Verified
```
Version: 3.1.0
Title: AlphaLab DYOR API
Stock coverage: ['- **923 NSE-listed stocks** across **49 sectors**']
```

Swagger UI: https://alphamarket.co.in/dyor/api/docs
ReDoc: https://alphamarket.co.in/dyor/api/redoc

---

## GIT LOG

| Commit | Message |
|--------|---------|
| `f5d44c1` | feat: Advisor onboarding walkthrough - 9-step contextual tour with spotlight, persists across logins until completed |

Note: DYOR main.py changes are not git-tracked (DYOR is a separate repo at github.com/monjit-TAM/Alphamarket — the dyor-backend lives at /opt/dyor-backend and is deployed directly).

---

## SERVER STATUS AT END OF SESSION

| Service | Status | Notes |
|---------|--------|-------|
| alphamarket (pm2 id 155) | online | Port 5001, 0 restarts |
| dyor-api | active | Port 8001, v3.1.0 |
| alpha-data-service | active | Port 5004 |
| Redis | ok | 216+ screener keys |
| PostgreSQL | ok | 15 users |
| Groww token | ok | 20.9 hours remaining |

---

## PENDING ITEMS

| Priority | Task |
|----------|------|
| HIGH | Rotate SendGrid API key (was shared in chat previously) |
| HIGH | Unpause Cloudflare (shows Paused in dashboard) |
| HIGH | Advisory Report Publishing to alphamarket.co.in advisor profile |
| HIGH | Basket history on advisor profile page |
| HIGH | XTS broker integration (alongside Upstox) |
| HIGH | Index Futures in Arbitrage/Jobbing/Scalping (NIFTY, BANKNIFTY) — verify when markets open |
| MED | Email notifications when advisor requests DYOR publish permission |
| MED | Screen Builder full universe cron (currently ~50 stocks on Yahoo, need all 923 from Redis) |
| MED | Advisory PDF fix on DYOR — Rs.0 price and empty tech/fund data |
| MED | Test push notifications end to end |
| LOW | Migrate legacy scrypt passwords to bcrypt |
| LOW | MTF Combiner — Medium column always shows 0 (cosmetic) |
| LOW | Failing symbols: MCDOWELL-N, TATAMOTORS, ZOMATO — 404 from data service (name changes) |

---

## SERVER DETAILS

| Item | Value |
|------|-------|
| DO Server | root@159.89.162.181 \| pw: tAM#8299 |
| AlphaMarket app | /var/www/alphamarket (Node/Express + React, port 5001) |
| DYOR backend | /opt/dyor-backend/main.py (FastAPI, port 8001) |
| Data service | /opt/alpha-data-service/main.py (port 5004) |
| PM2 build | npm run build → pm2 delete alphamarket → pm2 start ecosystem.config.cjs |
| DYOR restart | systemctl restart dyor-api |
| DB | postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db |
| Git | https://github.com/monjit-TAM/Alphamarket.git (main) |
| Swagger | https://alphamarket.co.in/dyor/api/docs (v3.1.0) |
| ReDoc | https://alphamarket.co.in/dyor/api/redoc |

---

## CRITICAL RULES

1. `req.session.userId` (NOT req.user.id) — AlphaMarket uses VARCHAR UUIDs
2. NEVER escape backticks in Python writing JavaScript
3. After Python edits routes.ts: `sed -i 's/\\`/\`/g'` and `sed -i 's/\\\${/\${/g'`
4. Build: `npm run build` → `pm2 delete` → `pm2 start` (NEVER pm2 restart)
5. Large code → write via `sudo python3 -c "content = open('/dev/stdin').read()..."` heredoc
6. AlphaMarket swagger is inline in `server/broker-api.ts` — `swagger.yaml` in root is empty/unused
7. DYOR swagger is auto-generated by FastAPI from `main.py` — edit the FastAPI app definition
8. AlphaMarket frontend uses `wouter` (NOT React Router) — use `useLocation` hook
9. Walkthrough keys: `am_wt_done_{userId}` and `am_wt_logins_{userId}`
10. DYOR venv: `/opt/dyor-backend/venv/bin/python3`
11. Kite tokens expire daily at 6 AM IST
12. NEVER warm cache during active users — causes 524 Cloudflare timeout

---

*End of Session Handover — AlphaMarket, 1 April 2026*
