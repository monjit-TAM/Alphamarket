#!/bin/bash
# Wait for uvicorn to be ready
sleep 15
# Check if cache is empty
COUNT=$(redis-cli -n 1 KEYS 'screener:*' | grep -v empty | wc -l)
if [ "$COUNT" -lt 10 ]; then
    echo "[$(date)] Cache empty ($COUNT keys), triggering warm..."
    /opt/dyor-backend/venv/bin/python3 /opt/dyor-backend/warm_cache_direct.py >> /var/log/dyor-warm.log 2>&1
    echo "[$(date)] Startup warm complete"
else
    echo "[$(date)] Cache OK ($COUNT keys), skipping warm"
fi
