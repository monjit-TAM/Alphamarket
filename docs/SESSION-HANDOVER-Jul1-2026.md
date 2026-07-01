# AlphaMarket Session Handover — July 1, 2026
## For continuation by next agent

## CRITICAL: Read First
- Full handover doc: /var/www/alphamarket/docs/HANDOVER-Jul2026.md
- Git repo: github.com/monjit-TAM/Alphamarket.git (branch: main)

## SERVER STATE (Jul 1, ~7:30 PM IST)
- Node (PM2 id:158): online, port 5001, /var/www/alphamarket/
- Python (systemd dyor-api): active, port 8001, /opt/dyor-backend/
- TrueData WebSocket: connected, 92 symbols, 85 cached prices
- SL Engine: active, 81 symbols, 91 entries, 2 triggers fired today
- DB: postgresql://alphamarket_user:AlphaMkt2026@localhost:5432/alphamarket_db
- 76 active equity calls, 7 active FnO positions, zero breached

## WHAT WAS DONE TODAY
1. Expiry format normalization (DD-MM-YYYY/ISO/epoch → YYYY-MM-DD)
2. Segment auto-detect (catches Equity on FnO positions)
3. Entry price validation (blocks option entry > strike)
4. Multi-leg rec_id fix
5. TrueData WebSocket integration (3-source pricing: Kite→TrueData→Groww)
6. Tick-by-tick SL/TP engine (fires on every trade tick, not 15s polling)
7. Admin broker-calls page with live LTP (3s refresh), P&L%, SL warnings
8. Enhanced broker reports with New Calls (DB) tab
9. Closed 11 breached calls + 4 expired positions
10. Commodity SL support (CRUDEOILM + NATURALGAS triggered successfully)
11. TECHM token fix, DIXON entry fix, JUBLFOOD segment fix

## TOMORROW PRIORITIES (Jul 2)
1. Test TrueData ticks at 9:16 AM: journalctl -u dyor-api -f | grep "SL Engine"
2. Test admin live prices: open /admin/broker-calls
3. Test Kambala PlaceOrder during market hours
4. Build option premium SL monitoring (options excluded from tick SL)
5. Fix MANKIND PHARMA symbol (has space)

## KEY RULES
- NEVER restart during market hours (9:15-3:30 IST)
- NEVER send webhooks directly to broker URLs (use admin endpoints)
- Python main.py: edit in /var/www/alphamarket/, copy to /opt/dyor-backend/
- Signing header: X-AlphaMarket-Signature (NOT X-Webhook-Signature)
- pip install: use /opt/dyor-backend/venv/bin/pip
- TrueData: only ONE connection per user

## SECRETS
- Session: j7LzUgscsxhDpM3SuS/iuz3SkjQcR5XIjxfMwEQxybHw27zRVj1khGafjxC35Nltgqz/j7ZM10WacTstOOw4qQ==
- Internal API: x-shared-secret: alphamarket-shared-2026
- TrueData: tdwsp531 / monjit@531 / port 8084 / push.truedata.in

## MORNING HEALTH CHECK
pm2 show alphamarket | grep "status|uptime"
curl -s http://localhost:8001/api/health
curl -s "http://localhost:8001/api/shared/truedata-status" -H "x-shared-secret: alphamarket-shared-2026"
curl -s "http://localhost:8001/api/shared/sl-engine-status" -H "x-shared-secret: alphamarket-shared-2026"
curl -s "http://localhost:8001/api/shared/kite-ltp/SBIN" -H "x-shared-secret: alphamarket-shared-2026"

## GIT COMMITS TODAY (13 commits)
31d84db fix: showAll param in broker-calls/active
1d41138 fix: commodity symbol -I mapping
e3448b2 fix: live prices includes TrueData
a496338 feat: live price dashboard + commodity SL
30fb59f feat: tick-by-tick SL/TP engine
de598a5 feat: TrueData WebSocket integration
19062b1 fix: new-calls multi-leg dedup
1458949 feat: enhanced broker reports UI
5fea934 feat: entry price validation
25ef8ab fix: expiry token, segment auto-detect
