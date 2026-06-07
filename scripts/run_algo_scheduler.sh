#!/bin/bash
# Algo Scanner — runs every 5 min during market hours
# Calls the scheduler endpoint which checks each algo's frequency internally

IKEY="3f9dd0ce942c74fb9988518041b50c94fa2da6aa2778da8c"
HOUR=$(TZ=Asia/Kolkata date +%H)
MIN=$(TZ=Asia/Kolkata date +%M)
DOW=$(TZ=Asia/Kolkata date +%u)

# Only run Mon-Fri (1-5), 9:15 AM to 3:35 PM IST
if [ "$DOW" -gt 5 ]; then exit 0; fi
if [ "$HOUR" -lt 9 ] || [ "$HOUR" -gt 15 ]; then exit 0; fi
if [ "$HOUR" -eq 9 ] && [ "$MIN" -lt 15 ]; then exit 0; fi
if [ "$HOUR" -eq 15 ] && [ "$MIN" -gt 35 ]; then exit 0; fi

# Run scanner cycle
curl -s -X POST -H "X-Internal-Key: $IKEY" http://localhost:8001/api/algos/scheduler/run-cycle >> /var/log/algo-scheduler.log 2>&1

# Check exits
curl -s -X POST -H "X-Internal-Key: $IKEY" http://localhost:8001/api/algos/monitor/check-exits >> /var/log/algo-scheduler.log 2>&1

echo "" >> /var/log/algo-scheduler.log
