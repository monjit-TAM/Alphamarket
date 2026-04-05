#!/bin/bash
COUNT=$(redis-cli -n 1 KEYS 'screener:*' | grep -v empty | wc -l)
if [ "$COUNT" -lt 10 ]; then
    echo "[$(date)] ALERT: Only $COUNT cache keys! Auto-warming..."
    /opt/dyor-backend/venv/bin/python3 /opt/dyor-backend/warm_cache_direct.py >> /var/log/dyor-warm.log 2>&1
    echo "[$(date)] Auto-warm complete. Keys: $(redis-cli -n 1 KEYS 'screener:*' | grep -v empty | wc -l)"
else
    echo "[$(date)] Cache healthy: $COUNT keys"
fi
