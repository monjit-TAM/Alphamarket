#!/bin/bash
# AlphaBot: Monitor positions + Auto-squareoff
LOG="/var/log/dyor-squareoff.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running monitor..." >> $LOG

# Call the monitor endpoint
RESULT=$(curl -s -X POST "http://localhost:8001/api/alphabot/monitor" 2>/dev/null)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Monitor result: $RESULT" >> $LOG

# Safety net: close stale signals (CORRECT DB credentials)
PGPASSWORD=DyorSecure2026Mar psql -h 127.0.0.1 -U dyor_user -d dyor_db -c "
UPDATE bot_signals 
SET status='AUTO_SQUAREOFF', exit_time=NOW(), exit_price=entry_price, pnl=0, pnl_pct=0 
WHERE status='ACTIVE' AND created_at::date < CURRENT_DATE;
" >> $LOG 2>&1
