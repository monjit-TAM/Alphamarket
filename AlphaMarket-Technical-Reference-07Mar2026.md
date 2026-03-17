# AlphaMarket Ecosystem — Complete Technical Reference
## Date: 17 March 2026 | Version: 3.4.0 (Updated from 2.2.0)
## Purpose: Complete context for a new agent to continue development

---

## 1. WHAT IS ALPHAMARKET

AlphaMarket is a SaaS marketplace ecosystem for Indian stock market investors, SEBI-registered advisors (RAs/RIAs), and brokers. It has five products running across two servers:

### Core Ecosystem (DigitalOcean Droplet — alphaforge-prod)
1. **alphamarket.co.in** — Main marketplace + auth gateway. Advisors publish trading strategies, investors subscribe.
2. **stocks.alphamarket.co.in** — Stock portfolio analysis tool (upload holdings → automated scoring, risk radar, rebalancing)
3. **mf.alphamarket.co.in** — Mutual fund portfolio analysis tool

### Independent Products (same server, DO NOT MODIFY unless explicitly asked)
4. **alphalensmf.com** — Standalone MF analysis product (different user base)
5. **testalpha.in** — Research/lab tool (AWS Lightsail `3.109.42.124`)

---

## 2. SERVER ARCHITECTURE

### 2.1 Production Server (alphaforge-prod)
```
Server: DigitalOcean Droplet (Ubuntu)
IP: 159.89.162.181
SSH: root@159.89.162.181 (or root@alphaforge-prod)
```

### 2.2 Applications & Ports

| App | Port | PM2 Name | Directory | Database | GitHub |
|-----|------|----------|-----------|----------|--------|
| AlphaMarket (main + auth) | 5001 | alphamarket | /var/www/alphamarket | alphamarket_db | monjit-TAM/Alphamarket |
| AlphaLensMF (MF analysis) | 5002 | alphalensmf | /var/www/alphalensmf | alphalensmf_db | monjit-TAM/alphalensmf |
| AlphaLens Stocks | 5003 | alphalens-stocks | /var/www/alphalens-stocks | alphamarket_db (shared) | monjit-TAM/alphalens-stocks |

### 2.3 Tech Stack
- **Backend**: Node.js + Express + TypeScript
- **Frontend**: React + Vite + Tailwind CSS
- **Database**: PostgreSQL (two databases: alphamarket_db, alphalensmf_db)
- **ORM**: Drizzle ORM with shared schema in `shared/schema.ts`
- **Process Manager**: PM2
- **Web Server**: Nginx (reverse proxy + SSL)
- **Build**: `npm run build` (Vite for client + esbuild for server → `dist/index.cjs`)
- **Build Script**: `script/build.ts` — uses esbuild with entry point `server/index.ts`

### 2.4 Database Connections
```
Main DB:  postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db
Auth DB:  Same as above (shared)
MF DB:    postgresql://alphalensmf_user:74406b9552f939cc582be2db2c70eeeb@localhost:5432/alphalensmf_db
```

Note: `psql -U postgres` fails with peer auth error. Use connection strings instead:
```bash
psql "postgresql://alphalensmf_user:74406b9552f939cc582be2db2c70eeeb@localhost:5432/alphamarket_db"
```

### 2.5 DNS (Cloudflare)

| Domain | Type | Points To | Proxy |
|--------|------|-----------|-------|
| alphamarket.co.in | A | 159.89.162.181 | Proxied |
| mf | A | 159.89.162.181 | Proxied |
| stocks | A | 159.89.162.181 | Proxied |
| www | A | 159.89.162.181 | Proxied |
| em3027 | CNAME | u60713346.wl097.sendgrid.net | DNS only |
| s1._domainkey | CNAME | s1.domainkey.u60713346.wl097.sendgrid.net | DNS only |
| s2._domainkey | CNAME | s2.domainkey.u60713346.wl097.sendgrid.net | DNS only |
| url4994 | CNAME | sendgrid.net | DNS only |
| 60713346 | CNAME | sendgrid.net | DNS only |
| _dmarc | TXT | v=DMARC1; p=none; | DNS only |

**Important**: Cloudflare shows "Paused" — needs to be unpaused for proxy/DDoS protection to work.

---

## 3. AUTHENTICATION ARCHITECTURE

SSO works via Nginx proxy:

1. **alphamarket.co.in (port 5001)** is the SOLE auth gateway
2. **Nginx** on stocks. and mf. proxies `/api/auth/*` requests to port 5001
3. **Session cookie** set on `.alphamarket.co.in` domain propagates to all subdomains
4. **OAuth**: Google + GitHub via Passport.js (credentials in `.env`)
5. **Password hashing**: bcrypt (new users) + scrypt (legacy). Both handled in `server/auth/passwords.ts`

### Auth Files
```
/var/www/alphamarket/server/auth/
├── index.ts       — Auth middleware (requireAuth, requireAdvisor, requireAdmin)
├── routes.ts      — Login, register, logout, forgot-password, reset-password
├── session.ts     — Express session config
├── passwords.ts   — bcrypt + scrypt password hashing/comparison
├── email.ts       — SendGrid email functions (registration, welcome, agreements, strategy alerts)
├── google.ts      — Google OAuth
└── github.ts      — GitHub OAuth
```

### Roles
- `investor` — Can browse, subscribe, receive notifications
- `advisor` — Can create strategies, publish calls, manage subscribers
- `admin` — Full access + user management

---

## 4. DATABASE SCHEMA (Key Tables)

### Users
```
users: id, username, password, email, phone, role (advisor/investor/admin),
       companyName, overview, themes[], logoUrl, sebiCertUrl, sebiRegNumber,
       isRegistered, isApproved, agreementConsent, activeSince, requireRiskProfiling
```

### Strategies
```
strategies: id, advisorId, name, type (Equity/Basket/Future/Commodity/CommodityFuture/Option),
            description, status (Draft/Published), theme[], managementStyle, horizon,
            keySectors[], volatility, riskLevel, benchmark, minimumInvestment,
            rebalanceFrequency, cagr, planIds[], totalRecommendations, stocksInBuyZone
```

### Calls (Equity stock recommendations)
```
calls: id, strategyId, stockName, action (Buy/Sell), buyRangeStart, buyRangeEnd,
       targetPrice, profitGoal, stopLoss, rationale, status (Active/Closed),
       entryPrice, sellPrice, gainPercent, callDate, exitDate,
       isPublished, publishMode (draft/watchlist/live),
       trailing_sl_enabled, trailing_sl_type, trailing_sl_value,
       trailing_sl_highest_price, trailing_sl_current_sl, trailing_sl_triggered_at
```

### Positions (F&O)
```
positions: id, strategyId, segment, callPut, buySell, symbol, expiry, strikePrice,
           entryPrice, lots, target, stopLoss, rationale, status, isPublished, publishMode,
           trailing_sl_enabled/type/value/highest_price/current_sl/triggered_at,
           exitPrice, exitDate, gainPercent
```

### Plans & Subscriptions
```
plans: id, advisorId, name, code, amount, durationDays
subscriptions: id, planId, strategyId, userId, advisorId, status, ekycDone, riskProfiling
payments: id, orderId, userId, strategyId, planId, advisorId, amount, status, cfOrderId, paymentSessionId
```

### Notifications & Push
```
notifications: id, type, title, body, data (jsonb), targetScope, strategyId, createdAt
push_subscriptions: id, userId, endpoint, p256dh, auth, createdAt
```

### Basket Strategy Tables (created dynamically in db.ts)
```
basket_rebalances: id, strategyId, version, effectiveDate, notes
basket_constituents: id, strategyId, rebalanceId, symbol, exchange, weightPercent, quantity, priceAtRebalance, action
basket_rationales: id, strategyId, title, body, category, attachments[]
basket_nav_snapshots: id, strategyId, asOfDate, nav, totalReturn, dailyReturn
```

### Other Tables
```
content, scores, watchlist, advisorQuestions, riskProfiles, passwordResetTokens,
ekycVerifications, esignAgreements, brokerApiKeys, brokerWebhookLogs
```

---

## 5. NOTIFICATION SYSTEM (v2.2.0)

### Three Channels
1. **In-App** — Stored in `notifications` table, served via `/api/notifications/recent`, displayed in bell popover
2. **Push** — Web Push via VAPID keys, stored in `push_subscriptions`, delivered via `web-push` library
3. **Email** — SendGrid API, sent via `sendStrategyAlertEmail()` in `server/auth/email.ts`

### Notification Flow
```
Advisor publishes call
  → routes.ts calls notifyStrategySubscribers() + notifyWatchlistUsers()
    → push.ts creates notification record (in-app)
    → push.ts sends push notification to subscribed browsers
    → push.ts fetches subscriber emails and calls sendStrategyAlertEmail() (NEW in v2.2)
```

### Events That Trigger Notifications

| Event | Subscribers Get | Watchlist Gets |
|-------|----------------|----------------|
| New call published | Push + In-app + Email (full details) | Push + In-app (masked) |
| Call updated (target/SL) | Push + In-app + Email | — |
| Call closed (manual) | Push + In-app + Email | Push + In-app (masked) |
| Call closed (auto SL/target) | Push + In-app + Email | Push + In-app (masked) |
| New position published | Push + In-app + Email | Push + In-app (masked) |
| Position closed | Push + In-app + Email | Push + In-app (masked) |

### Auto SL/Target Detection (scheduler.ts)
- `checkStopLossAndTargets()` runs every 60 seconds
- Only during market hours: 9:15 AM - 3:30 PM IST
- Skips Intraday strategies (handled by `autoSquareOffIntraday()`)
- Checks active published calls/positions against live prices from Groww API
- Supports: regular SL, target, trailing SL (PERCENTAGE and ABSOLUTE types)
- Auto-closes and fires full notification pipeline

### Email Configuration (.env)
```
SENDGRID_API_KEY=SG.xxxxx (NEEDS ROTATION — was shared in chat)
SENDGRID_FROM_EMAIL=hello@alphamarket.co.in
APP_URL=https://alphamarket.co.in
VAPID_PUBLIC_KEY=BAZ8RmKaEXw72g2eQxIV4D1kC6dGzFNZcP3fBkVFPiPCV-9i-xUDV7vlOqlLk9u5e0KpG57CB44WK4HZMUJvggg
VAPID_PRIVATE_KEY=xjb00PHZ-iIpDr-3Fk9Zaqh4HwsDJHAG0OAmQ_8z9YQ
VAPID_SUBJECT=mailto:admin@alphamarket.com
```

---

## 6. API REFERENCE

### Public Endpoints (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/advisors | List approved advisors |
| GET | /api/advisors/:id | Advisor detail |
| GET | /api/strategies/public | Published strategies marketplace |
| GET | /api/strategies/:id | Strategy detail |
| GET | /api/strategies/:id/calls | Published calls (masked for non-subscribers) |
| GET | /api/strategies/:id/positions | Published positions |
| GET | /api/strategies/:id/plans | Subscription plans |
| GET | /api/strategies/:id/basket/* | Basket data (rebalances, constituents, rationale, performance) |
| GET | /api/live-price/:symbol | Single stock live price |
| POST | /api/live-prices/bulk | Bulk live prices |
| GET | /api/symbols/search?q= | Stock symbol search |
| GET | /api/option-chain/expiries | Option expiry dates |
| GET | /api/option-chain?symbol=&expiry= | Option chain data |
| GET | /api/content/public/:type | Public content |
| GET | /api/live-call-counts | Live call counts per strategy |
| GET | /api/notifications/vapid-key | VAPID public key |
| GET | /sitemap.xml | SEO sitemap |

### Auth Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET | /api/auth/me | Current user |
| POST | /api/auth/forgot-password | Request reset email |
| POST | /api/auth/reset-password | Reset with token |
| GET | /api/auth/google | Google OAuth |
| GET | /api/auth/github | GitHub OAuth |

### Investor Endpoints (requireAuth)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/strategies/:id/subscribe | Subscribe to strategy |
| GET | /api/strategies/:id/subscription-status | Check subscription |
| GET | /api/strategies/:id/performance | Strategy performance |
| POST | /api/payments/create-order | Create Cashfree order |
| POST | /api/payments/verify | Verify payment |
| GET | /api/payments/history | Payment history |
| POST/DELETE | /api/investor/watchlist | Add/remove watchlist |
| GET | /api/investor/watchlist/ids | Watchlisted IDs |
| GET | /api/notifications/recent | User's notifications |
| POST | /api/notifications/subscribe | Enable push |
| DELETE | /api/notifications/subscribe | Disable push |

### Advisor Endpoints (requireAdvisor)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/advisor/strategies | Advisor's strategies (enriched with activeCallDetails) |
| POST | /api/strategies | Create strategy |
| PATCH | /api/strategies/:id | Update strategy |
| DELETE | /api/strategies/:id | Delete strategy |
| POST | /api/strategies/:id/calls | Create call |
| PATCH | /api/calls/:id | Update call (target/SL) |
| POST | /api/calls/:id/close | Close call |
| POST | /api/calls/:id/publish | Publish draft call |
| PATCH | /api/calls/:id/exit | Exit call |
| POST | /api/strategies/:id/positions | Create position |
| PATCH | /api/positions/:id | Update position |
| POST | /api/positions/:id/close | Close position |
| POST | /api/positions/:id/publish | Publish position |
| PATCH | /api/positions/:id/exit | Exit position |
| POST | /api/strategies/:id/basket/rebalance | Create basket rebalance |
| POST | /api/strategies/:id/basket/rationale | Add rationale |
| DELETE | /api/strategies/:id/basket/rationale/:id | Delete rationale |
| GET | /api/advisor/plans | Get plans |
| POST | /api/plans | Create plan |
| DELETE | /api/plans/:id | Delete plan |
| GET | /api/advisor/subscribers | Subscriber list |
| GET | /api/advisor/subscriptions | Subscription list |
| PATCH | /api/advisor/profile | Update profile |
| GET | /api/advisor/content | Get content |
| POST | /api/content | Create content |
| DELETE | /api/content/:id | Delete content |
| GET | /api/advisor/scores | Compliance scores |
| POST | /api/advisor/scores | Submit scores |
| GET | /api/advisor/payments | Payments received |
| GET | /api/advisor/reports/download | Download reports |

### Admin Endpoints (requireAdmin)
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/admin/notifications | Broadcast notification |

### Broker API v1 (x-api-key header)
- Base URL: `https://alphamarket.co.in/api/v1/alpha/`
- Swagger UI: https://alphamarket.co.in/api/docs/
- Spec defined in: `server/broker-api.ts` → `getSwaggerSpec()`
- Version: 2.2.0

---

## 7. KEY FILE LOCATIONS

### Server
```
/var/www/alphamarket/
├── server/
│   ├── index.ts              — Express app entry point
│   ├── routes.ts             — All API routes (2636 lines)
│   ├── storage.ts            — Database operations (Drizzle ORM interface)
│   ├── db.ts                 — Database connection + basket table creation
│   ├── push.ts               — Push + in-app + email notification system
│   ├── scheduler.ts          — Intraday auto-square-off + SL/Target monitoring
│   ├── broker-api.ts         — Broker API v1 routes + swagger spec
│   ├── webhook-dispatcher.ts — Webhook delivery to brokers
│   ├── groww.ts              — Live price API (Groww)
│   ├── cashfree.ts           — Payment gateway
│   ├── sandbox-kyc.ts        — eKYC integration
│   ├── seed.ts               — Database seeding
│   ├── static.ts             — Static file serving
│   ├── vite.ts               — Vite dev server
│   └── auth/
│       ├── index.ts          — Auth middleware
│       ├── routes.ts         — Auth routes
│       ├── session.ts        — Session config
│       ├── passwords.ts      — Password hashing (bcrypt + scrypt)
│       ├── email.ts          — SendGrid email functions
│       ├── google.ts         — Google OAuth
│       └── github.ts         — GitHub OAuth
├── shared/
│   └── schema.ts             — Drizzle ORM schema (all tables)
├── client/src/
│   ├── pages/
│   │   ├── strategies-marketplace.tsx (259 lines)
│   │   ├── strategy-detail.tsx (964 lines)
│   │   ├── strategy-performance.tsx (473 lines)
│   │   ├── advisor-detail.tsx (343 lines)
│   │   ├── advisors-listing.tsx (223 lines)
│   │   ├── home.tsx (13326 bytes)
│   │   ├── investor-dashboard.tsx (42257 bytes)
│   │   ├── auth.tsx (33063 bytes)
│   │   ├── dashboard/
│   │   │   ├── index.tsx           — Dashboard layout + sidebar
│   │   │   ├── dashboard-home.tsx  — Advisor home (revenue, live calls, customers)
│   │   │   ├── strategy-management.tsx (147KB!) — Strategy CRUD + call management
│   │   │   ├── advisor-profile.tsx
│   │   │   ├── plans.tsx
│   │   │   ├── payments-page.tsx
│   │   │   ├── questions-page.tsx
│   │   │   ├── content-page.tsx
│   │   │   └── reports.tsx
│   │   └── admin/
│   │       ├── index.tsx
│   │       ├── admin-advisors.tsx
│   │       ├── admin-strategies.tsx
│   │       └── admin-settings.tsx
│   └── components/
│       ├── navbar.tsx
│       ├── notification-bell.tsx
│       ├── strategy-card.tsx
│       └── footer.tsx
├── attached_assets/          — Logo and screenshots (@assets alias)
├── ecosystem.config.cjs      — PM2 config (reads .env)
├── script/build.ts           — Build script (Vite + esbuild)
├── swagger.yaml              — EMPTY (unused — spec is in broker-api.ts)
└── .env                      — Environment variables
```

### Config Files
```
/etc/nginx/sites-available/alphamarket.co.in
/etc/nginx/sites-available/stocks.alphamarket.co.in
/etc/nginx/sites-available/mf.alphamarket.co.in
```

### Backups
```
/var/www/backups/
├── .env.bak.20260307_*
├── notification_patch_20260307_141545/
│   ├── email.ts
│   ├── push.ts
│   └── scheduler.ts
└── (older backups from previous sessions)
```

---

## 8. BUILD & DEPLOY PROCESS

```bash
# SSH into server
ssh root@159.89.162.181

# Standard deploy
cd /var/www/alphamarket
npm run build 2>&1 | tail -10

# IMPORTANT: PM2 caches env vars. To reload .env:
pm2 delete alphamarket
pm2 start ecosystem.config.cjs

# Or for simple restarts (no env changes):
pm2 restart alphamarket

# Check logs
pm2 logs alphamarket --lines 20 --nostream

# ALWAYS backup before major changes:
mkdir -p /var/www/backups/$(date +%Y%m%d_%H%M%S)
cp server/*.ts /var/www/backups/$(date +%Y%m%d_%H%M%S)/
```

### Build Pipeline
1. `npm run build` runs `tsx script/build.ts`
2. Client: Vite builds React → `dist/public/`
3. Server: esbuild bundles `server/index.ts` → `dist/index.cjs`
4. Path aliases: `@assets` → `attached_assets/`, `@shared` → `shared/`, `@/*` → `client/src/*`
5. External deps (not bundled): `@sendgrid/mail`, `web-push`, `bcryptjs`, etc.

### PM2 Environment Loading
`ecosystem.config.cjs` reads `.env` and passes it as `env` to PM2. This means:
- Changing `.env` requires `pm2 delete` + `pm2 start` (not just restart)
- `pm2 restart --update-env` sometimes works but is unreliable
- Always verify with `pm2 env <id> | grep KEY_NAME`

---

## 9. IMPORTANT RULES

1. **NEVER modify testalpha.in** — it runs independently on AWS Lightsail
2. **NEVER modify alphalensmf.com** directly unless specifically asked
3. **ALWAYS backup before patching** — save originals to `/var/www/backups/`
4. **Auth changes are HIGH RISK** — SSO system is delicate, test in incognito
5. **Build before restart** — `npm run build` then PM2 restart
6. **The UI design system** follows thealphalens.in — clean cards, badges, Tailwind CSS
7. **Stock analysis engine** (stocks app): `stock-service.ts` (67KB), `analysis-extensions.ts` (24KB)
8. **strategy-management.tsx is 147KB** — the largest file, be careful with patches
9. **The user's name is Monjit** (username monjitg). Server access via Mac terminal.
10. **No network access from Claude** — all changes via SCP + SSH commands to user

---

## 10. QUICK VERIFICATION COMMANDS

```bash
# All apps running?
pm2 status

# Health check
curl -s http://localhost:5001/api/notifications/vapid-key
curl -s http://localhost:5003 | head -5   # stocks
curl -s http://localhost:5002 | head -5   # mf

# Database
psql "postgresql://alphalensmf_user:74406b9552f939cc582be2db2c70eeeb@localhost:5432/alphamarket_db" -c "SELECT count(*) FROM users;"

# Nginx
nginx -t

# Disk / Memory
df -h
free -m

# Recent errors
pm2 logs alphamarket --lines 50 --err --nostream

# Notification system
psql "postgresql://alphalensmf_user:74406b9552f939cc582be2db2c70eeeb@localhost:5432/alphamarket_db" -c "SELECT count(*) FROM notifications;"
psql "postgresql://alphalensmf_user:74406b9552f939cc582be2db2c70eeeb@localhost:5432/alphamarket_db" -c "SELECT count(*) FROM push_subscriptions;"

# Git status
cd /var/www/alphamarket && git log --oneline -5
```

---

## 11. EXTERNAL SERVICES

| Service | Purpose | Config Location |
|---------|---------|-----------------|
| SendGrid | Transactional email | `.env` SENDGRID_API_KEY |
| Cloudflare | DNS + CDN + DDoS | dash.cloudflare.com (Monjit's account) |
| Cashfree | Payment gateway | `.env` CASHFREE_* |
| Groww | Live stock prices | `server/groww.ts`, persisted access token |
| Sandbox (Digilocker) | eKYC verification | `server/sandbox-kyc.ts` |
| Google OAuth | Social login | `.env` GOOGLE_CLIENT_ID/SECRET |
| GitHub OAuth | Social login | `.env` GITHUB_CLIENT_ID/SECRET |

---

*End of Technical Reference — AlphaMarket Ecosystem, 7 March 2026*


---

## 12. CHANGES SINCE v2.2.0 (7 Mar — 17 Mar 2026)

### 12.1 New Applications & Services

| Service | Port | Purpose | Endpoint |
|---------|------|---------|----------|
| AlphaMarket | 5001 | Main marketplace + portfolio platform | alphamarket.co.in |
| Stock Analyzer | 5003 | Equity analysis engine | stocks.alphamarket.co.in |
| MF Analyzer | 5002 | Mutual fund analysis engine | mf.alphamarket.co.in |

### 12.2 New Database Tables (since v2.2)

- `advisor_bank_details` — Bank account info for advisor payouts
- `advisor_payments` — Revenue credits and payment requests (credit/debit, pending/completed/rejected)
- `customer_portfolios` — Investor portfolios (multiple per user)
- `portfolio_holdings` — 14 asset types with 23 columns (including premium, sum_assured, maturity_date, interest_rate, policy_number, provider)
- `portfolio_suggestions` — AI-generated suggestions per portfolio
- `portfolio_analyses` — Deep analysis results (owned by alphalensmf_user)
- `advisor_recommendations` — Advisor action items with file attachments
- `financial_goals` — 9 goal types with SIP projections
- `advisor_microsites` — 6-tab advisor branding config
- `advisor_questions` — Investor Q&A per advisor
- `app_settings` — Key-value config store (Groww token, monetization_config)

### 12.3 New API Endpoints (42 endpoints added)

**Admin (requireAdmin):**
- `GET /api/admin/dashboard-stats` — Platform aggregate stats
- `GET /api/admin/advisor/:id/analytics` — Per-advisor analytics
- `GET /api/admin/advisor/:id/bank-details` — Bank account info
- `GET /api/admin/advisor/:id/payments` — Revenue/payment history
- `POST /api/admin/advisor/:id/add-revenue` — Credit revenue
- `PUT /api/admin/advisor/:id/process-payment/:paymentId` — Approve/reject
- `GET /api/admin/monetization-config` — Read pricing config
- `PUT /api/admin/monetization-config` — Save pricing config
- `POST /api/admin/notifications` — Broadcast push notification

**Public (no auth):**
- `GET /api/monetization-config` — Pricing/free tier config

**Portfolio (requireAuth):**
- `POST /api/portfolio/import-csv` — CSV holdings import
- `POST /api/portfolio/import-cas` — CAS PDF import
- `POST /api/portfolio/:id/add-holding` — Manual holding add (14 asset types)
- `POST /api/portfolio/:id/sync-prices` — Live price sync
- `POST /api/portfolio/:id/deep-analysis` — Full analysis (equity + MF + other)
- `GET /api/portfolio/:id/pdf-report` — Branded PDF generation
- `PUT /api/portfolio/holding/:holdingId` — Manual price update
- `POST /api/portfolio/:id/suggestions` — AI suggestions
- `POST /api/portfolio/:id/goals` — Financial goals
- `POST /api/portfolio/:id/recommend` — Advisor recommendation
- `POST /api/portfolio/create` — Create new portfolio

**Internal (server-to-server):**
- `POST localhost:5002/api/analyze-direct` — MF direct analysis (no auth)
- `POST localhost:5003/api/v1/analyze` — Stock analysis (X-API-Key)

### 12.4 New Frontend Pages

| Page | Path | Description |
|------|------|-------------|
| Admin Dashboard Home | /admin | 8 stat cards, clickable navigation |
| Admin Monetization | /admin/monetization | Pricing config for 5 products |
| Admin Advisors (updated) | /admin/advisors | Analytics tab, Bank & Pay dialog |
| Subscriber Portfolio | /dashboard/subscriber/:id/portfolio | Full-page portfolio dashboard |
| Deep Analysis Panel | (embedded component) | Multi-tab analysis results |
| DYOR Research | /dyor | Stock research tool |
| Advisor Microsite | /advisor/:slug | Public advisor profile |
| Product Guide | (sidebar link) | Interactive walkthrough |

### 12.5 PDF Report Engine (server/pdf-report.ts — 900+ lines)

Built with PDFKit for A4 reports:
- Cover page with advisor branding (logo, SEBI reg, contact)
- Table of Contents with section checkboxes
- Portfolio Overview with metric cards
- Health Score with component breakdown
- **Card-based stock holdings** (rounded boxes, accent bars, action badges)
- **Asset Allocation donut chart** with center value and legend
- **Top Holdings bar chart** (top 8 by value)
- **Sector Allocation donut + horizontal bars**
- Quantamental analysis per stock
- Value & Growth analysis tables
- Dividend yield + Tax impact (STCG/LTCG per Indian law)
- MF Holdings with risk metrics
- MF Stress Tests, Forward Projections, Health Check
- MF Overlap + Stock-MF Cross-Asset Overlap
- Other Assets (Gold, FD, RE, Insurance, PPF/NPS/EPF)
- Investment Style Profile (Value vs Growth bar)
- Rebalancing suggestions (card-style)
- 5-section disclaimer page
- Footer with advisor info + copyright

### 12.6 Key Architecture Decisions

1. **Deep analysis is cross-service**: AlphaMarket orchestrates calls to Stock Analyzer (5003) and MF Analyzer (5002), then combines results
2. **MF Analyzer has direct endpoint**: `POST /api/analyze-direct` accepts JSON without session auth (for server-to-server)
3. **Monetization config in app_settings**: JSON blob, not separate tables — easy to extend
4. **Analytics counts both tables**: Recommendations = calls + positions (F&O uses positions table)
5. **PDF uses PDFKit path API for donuts**: SVG-style arc drawing for pie/donut charts
6. **Portfolio holdings table is polymorphic**: 14 asset types share one table with nullable columns (premium, sum_assured, etc.)
7. **Sticky nav uses IntersectionObserver**: Active section tracking without scroll event listeners

### 12.7 Git Repositories

| Repo | URL | Branch |
|------|-----|--------|
| AlphaMarket | https://github.com/monjit-TAM/Alphamarket.git | main |
| MF Analyzer | https://github.com/monjit-TAM/alphalensmf.git | main |

### 12.8 Swagger API Documentation

- **URL**: https://alphamarket.co.in/api/docs
- **Version**: v3.4 (updated 17 Mar 2026)
- **Tags**: Advisors, Strategies, Recommendations, Admin, Monetization, Public
- **Auth**: x-api-key header (Broker API), session cookies (web app)

### 12.9 Current PM2 Process List
```
alphamarket        (id: 140)  port 5001  /var/www/alphamarket
alphalensmf        (id: 139)  port 5002  /var/www/alphalensmf
alphalens-stocks   (id: 8)    port 5003  /var/www/alphalens-stocks
```

---

*Updated: 17 March 2026 — v3.4.0*
