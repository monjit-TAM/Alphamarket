#!/bin/bash
# AlphaBot: Monitor positions + Auto-squareoff
# Runs during market hours to check SL/Target hits
# At 3:20 PM IST (9:50 UTC), auto-squares off all remaining positions with live P&L
LOG="/var/log/dyor-squareoff.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Running monitor..." >> $LOG

# Call the monitor endpoint which checks SL/Target AND does 3:20 PM auto-squareoff
RESULT=$(curl -s -X POST "http://localhost:8001/api/alphabot/monitor" 2>/dev/null)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Monitor result: $RESULT" >> $LOG

# Safety net: close any signals older than today that somehow survived
PGPASSWORD=AlphaMkt2026 psql -h 127.0.0.1 -U alphamarket_user -d alphamarket_db -c "
UPDATE bot_signals 
SET status='AUTO_SQUAREOFF', exit_time=NOW(), exit_price=entry_price, pnl=0, pnl_pct=0 
WHERE status='ACTIVE' AND created_at::date < CURRENT_DATE;
" >> $LOG 2>&1
